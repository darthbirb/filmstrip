//! Files on a drive with no Recycle Bin, a USB stick, an SD card or a network share: told apart
//! before Delete sends anything, and deleted outright only once asked. Nothing here is journalled.
//! DECISIONS.md "A drive with no Recycle Bin".

use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{folders, items};
use crate::error::{AppError, Reason, Result};
use crate::fs::paths;
use crate::fs::recycle::{Bin, Shell};
use crate::fs::stayed::{self, Stayed};

/// A drive with no Recycle Bin, as Explorer names it, and the files asked about on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BinlessDrive {
    pub drive: String,
    pub files: Vec<BinlessFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BinlessFile {
    pub id: i64,
    pub name: String,
    pub bytes: i64,
}

/// Which of these live files are on a drive with no Recycle Bin, under each drive in the order
/// they first come; the rest are left out, to be sent as ever.
pub fn among(conn: &Connection, item_ids: &[i64]) -> Result<Vec<BinlessDrive>> {
    let mut drives: Vec<BinlessDrive> = Vec::new();
    let mut folders: HashMap<i64, Option<String>> = HashMap::new();
    for &item_id in item_ids {
        if !items::is_live(conn, item_id)? {
            continue;
        }
        let Some(file) = items::file_of(conn, item_id)? else {
            continue;
        };
        let drive = match folders.get(&file.folder_id) {
            Some(drive) => drive.clone(),
            None => {
                let drive = Shell.binless(&paths::folder_dir(conn, file.folder_id)?);
                folders.insert(file.folder_id, drive.clone());
                drive
            }
        };
        let Some(drive) = drive else {
            continue;
        };
        let one = BinlessFile {
            id: item_id,
            name: file.disk_name,
            bytes: items::size_of(conn, item_id)?.unwrap_or_default(),
        };
        match drives.iter_mut().find(|held| held.drive == drive) {
            Some(held) => held.files.push(one),
            None => drives.push(BinlessDrive {
                drive,
                files: vec![one],
            }),
        }
    }
    Ok(drives)
}

/// The files at or below a folder that are on a drive with no Recycle Bin. Its folders are looked
/// at first, so a folder on a drive with a bin answers without reading each of its files.
pub fn under(conn: &Connection, folder_id: i64) -> Result<Vec<BinlessDrive>> {
    let mut folders = folders::descendants(conn, folder_id)?;
    folders.push(folder_id);
    let mut none = true;
    for folder in folders {
        if Shell.binless(&paths::folder_dir(conn, folder)?).is_some() {
            none = false;
            break;
        }
    }
    if none {
        return Ok(Vec::new());
    }
    among(conn, &items::live_under(conn, folder_id)?)
}

/// What deleting files for good did: how many went, and each one that stayed, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GoneReport {
    pub deleted: u32,
    pub refused: Vec<Stayed>,
}

/// Deletes each file outright from its drive with no Recycle Bin, once asked; nothing is journalled,
/// so nothing can bring them back.
pub fn delete_items(conn: &Connection, item_ids: &[i64]) -> Result<GoneReport> {
    let _turn = super::turn();
    let mut report = GoneReport::default();
    for &item_id in item_ids {
        match delete_unjournalled(conn, item_id) {
            Ok(()) => report.deleted += 1,
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// Whether a live file is on a drive with no Recycle Bin.
pub(super) fn is_binless(conn: &Connection, item_id: i64) -> Result<bool> {
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    Ok(Shell.binless(&from).is_some())
}

/// Deletes one file outright and retires its row, as a walk retires a file it finds gone. Only a
/// file on a drive with no Recycle Bin ever is; one open in another app or read-only stays whole.
pub(super) fn delete_unjournalled(conn: &Connection, item_id: i64) -> Result<()> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::invalid("that file is no longer in the index"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let meta = match std::fs::symlink_metadata(&from) {
        Ok(meta) if meta.is_file() => meta,
        _ => {
            return Err(AppError::refused(Reason::NotOnDisk {
                name: file.disk_name,
            }));
        }
    };
    if Shell.binless(&from).is_none() {
        return Err(AppError::invalid(format!(
            "{} is on a drive with a Recycle Bin, so it is never deleted outright",
            file.disk_name
        )));
    }
    if meta.permissions().readonly() {
        return Err(AppError::refused(Reason::PermissionDenied));
    }
    std::fs::remove_file(&from)?;
    // The file is gone whatever the index says now; a row left live is retired by the next walk.
    if let Err(err) = items::retire(conn, item_id) {
        eprintln!(
            "binless: {} is gone, its row not yet: {err}",
            from.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, journal};
    use crate::fs::recycle::tests::{Fake, Stand, stand_in_as};
    use crate::fs::{settles_to, trash, walk};
    use std::path::{Path, PathBuf};
    use std::rc::Rc;

    /// Trips/Cairo holding pyramid.jpg and sphinx.jpg on a drive with a Recycle Bin, and Stick/Lisbon
    /// holding tram.jpg and fado.mov on one without, walked into a real file.
    fn library(name: &str) -> (Connection, PathBuf, Rc<Fake>) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-binless")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::create_dir_all(root.join("Stick/Lisbon")).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        std::fs::write(root.join("Trips/Cairo/sphinx.jpg"), "s").unwrap();
        std::fs::write(root.join("Stick/Lisbon/tram.jpg"), "tram").unwrap();
        std::fs::write(root.join("Stick/Lisbon/fado.mov"), "fado!").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let mut bin = Fake::new(Stand::Recycles(dir.join("bin")));
        bin.binless = vec![(root.join("Stick"), "USB Drive (E:)".into())];
        (conn, root, stand_in_as(bin))
    }

    fn id_of(conn: &Connection, path: &[&str], name: &str) -> i64 {
        let mut folder = folders::source_root_folder(conn, 1).unwrap();
        for part in path {
            folder = folders::child_id(conn, folder, part).unwrap().unwrap();
        }
        items::existing_by_disk_name(conn, folder, name)
            .unwrap()
            .unwrap()
            .id
    }

    #[test]
    fn a_file_on_a_drive_with_no_bin_is_told_apart_from_one_the_bin_merely_refuses() {
        let (conn, root, bin) = library("told-apart");
        let pyramid = id_of(&conn, &["Trips", "Cairo"], "pyramid.jpg");
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let fado = id_of(&conn, &["Stick", "Lisbon"], "fado.mov");

        assert_eq!(
            among(&conn, &[pyramid, tram, fado]).unwrap(),
            [BinlessDrive {
                drive: "USB Drive (E:)".into(),
                files: vec![
                    BinlessFile {
                        id: tram,
                        name: "tram.jpg".into(),
                        bytes: 4,
                    },
                    BinlessFile {
                        id: fado,
                        name: "fado.mov".into(),
                        bytes: 5,
                    },
                ],
            }]
        );
        assert!(among(&conn, &[pyramid]).unwrap().is_empty());
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        assert!(under(&conn, trips).unwrap().is_empty());
        let under_top: Vec<i64> = under(&conn, top).unwrap()[0]
            .files
            .iter()
            .map(|file| file.id)
            .collect();
        assert_eq!(under_top.len(), 2);
        assert!(under_top.contains(&tram) && under_top.contains(&fado));

        // Sent anyway, it is refused for its drive and never handed to the shell.
        let report = trash::trash_items(&conn, &[pyramid, tram], &journal::new_batch()).unwrap();
        assert_eq!(report.trashed, 1);
        assert_eq!(report.refused.len(), 1);
        assert_eq!(
            (report.refused[0].id, &report.refused[0].reason),
            (
                tram,
                &Reason::NoBin {
                    drive: "USB Drive (E:)".into()
                }
            )
        );
        assert_eq!(
            bin.asked.borrow().as_slice(),
            [root.join("Trips/Cairo/pyramid.jpg")]
        );
        settles_to(&root.join("Stick/Lisbon"), &["fado.mov", "tram.jpg"]);
        assert!(items::is_live(&conn, tram).unwrap());
    }

    #[test]
    fn deleted_for_good_a_file_goes_outright_with_nothing_to_undo() {
        let (conn, root, bin) = library("for-good");
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let fado = id_of(&conn, &["Stick", "Lisbon"], "fado.mov");

        let report = delete_items(&conn, &[tram, fado]).unwrap();

        assert_eq!(
            report,
            GoneReport {
                deleted: 2,
                refused: vec![]
            }
        );
        settles_to(&root.join("Stick/Lisbon"), &[]);
        assert!(bin.asked.borrow().is_empty());
        assert!(!items::is_live(&conn, tram).unwrap());
        assert!(!items::is_trashed(&conn, tram).unwrap());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
        assert!(trash::listing(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_file_on_a_drive_with_a_bin_is_never_deleted_outright() {
        let (conn, root, bin) = library("has-a-bin");
        let pyramid = id_of(&conn, &["Trips", "Cairo"], "pyramid.jpg");

        let report = delete_items(&conn, &[pyramid]).unwrap();

        assert_eq!(report.deleted, 0);
        assert_eq!(report.refused[0].id, pyramid);
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        assert!(bin.asked.borrow().is_empty());
        assert!(items::is_live(&conn, pyramid).unwrap());
    }

    #[test]
    fn a_read_only_file_would_not_go_and_stays_whole_while_the_rest_go() {
        let (conn, root, _) = library("read-only");
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let fado = id_of(&conn, &["Stick", "Lisbon"], "fado.mov");
        let kept = root.join("Stick/Lisbon/tram.jpg");
        let mut permissions = std::fs::metadata(&kept).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&kept, permissions).unwrap();

        let report = delete_items(&conn, &[tram, fado]).unwrap();

        assert_eq!(report.deleted, 1);
        assert_eq!(report.refused.len(), 1);
        assert_eq!(
            (report.refused[0].id, &report.refused[0].reason),
            (tram, &Reason::PermissionDenied)
        );
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "tram");
        assert!(items::is_live(&conn, tram).unwrap());
        assert!(!items::is_live(&conn, fado).unwrap());
        settles_to(&root.join("Stick/Lisbon"), &["tram.jpg"]);

        let mut permissions = std::fs::metadata(&kept).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(&kept, permissions).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_file_open_in_another_app_would_not_go_and_stays_whole() {
        let (conn, root, _) = library("in-use");
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let open = open_alone(&root.join("Stick/Lisbon/tram.jpg"));

        let report = delete_items(&conn, &[tram]).unwrap();
        drop(open);

        assert_eq!(report.deleted, 0);
        assert_eq!(report.refused[0].reason, Reason::InUse);
        assert_eq!(
            std::fs::read_to_string(root.join("Stick/Lisbon/tram.jpg")).unwrap(),
            "tram"
        );
        assert!(items::is_live(&conn, tram).unwrap());
    }

    fn lisbon(conn: &Connection) -> i64 {
        let top = folders::source_root_folder(conn, 1).unwrap();
        let stick = folders::child_id(conn, top, "Stick").unwrap().unwrap();
        folders::child_id(conn, stick, "Lisbon").unwrap().unwrap()
    }

    #[test]
    fn a_folder_whose_files_go_for_good_goes_once_they_have_with_nothing_to_undo() {
        let (conn, root, bin) = library("folder");
        let lisbon = lisbon(&conn);
        let batch = journal::new_batch();

        let report = crate::fs::folders::delete(
            &conn,
            lisbon,
            Some(crate::fs::folders::Contents::Permanently),
            &batch,
        )
        .unwrap();

        assert!(report.deleted, "{:?}", report.refused);
        assert_eq!(report.outright, 2);
        assert!(!root.join("Stick/Lisbon").exists());
        assert!(!folders::is_live(&conn, lisbon).unwrap());
        assert!(bin.asked.borrow().is_empty());
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }

    #[test]
    fn a_folder_emptied_before_the_answer_goes_with_undo_and_comes_back() {
        let (conn, root, bin) = library("folder-emptied");
        let lisbon = lisbon(&conn);
        let stick = folders::parent(&conn, lisbon).unwrap().unwrap();
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let fado = id_of(&conn, &["Stick", "Lisbon"], "fado.mov");
        let moved =
            crate::fs::items::move_items(&conn, &[tram, fado], stick, &journal::new_batch())
                .unwrap();
        assert_eq!(moved.moved, 2, "{:?}", moved.refused);
        let batch = journal::new_batch();

        let report = crate::fs::folders::delete(
            &conn,
            lisbon,
            Some(crate::fs::folders::Contents::Permanently),
            &batch,
        )
        .unwrap();

        assert!(report.deleted, "{:?}", report.refused);
        assert_eq!(report.outright, 0);
        assert!(!root.join("Stick/Lisbon").exists());
        let ops: Vec<String> = journal::batch(&conn, &batch)
            .unwrap()
            .into_iter()
            .map(|entry| entry.op)
            .collect();
        assert_eq!(ops, [journal::FOLDER_DELETE]);

        let back = crate::fs::undo::undo_last(&conn).unwrap().unwrap();

        assert_eq!(back.batch.batch_id, batch);
        assert!(folders::is_live(&conn, lisbon).unwrap());
        assert!(root.join("Stick/Lisbon").is_dir());
        settles_to(&root.join("Stick"), &["Lisbon", "fado.mov", "tram.jpg"]);
        assert!(bin.asked.borrow().is_empty());
    }

    #[test]
    fn a_folder_across_two_drives_sends_some_to_the_bin_and_undo_brings_back_those_alone() {
        let (conn, root, _) = library("folder-across");
        std::fs::write(root.join("Trips/boat.jpg"), "boat").unwrap();
        walk::reconcile(&conn).unwrap();
        let mut bin = Fake::new(Stand::Recycles(root.parent().unwrap().join("bin")));
        bin.binless = vec![(root.join("Trips/Cairo"), "USB Drive (E:)".into())];
        let bin = stand_in_as(bin);
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let boat = id_of(&conn, &["Trips"], "boat.jpg");
        let pyramid = id_of(&conn, &["Trips", "Cairo"], "pyramid.jpg");
        let batch = journal::new_batch();

        let report = crate::fs::folders::delete(
            &conn,
            trips,
            Some(crate::fs::folders::Contents::Permanently),
            &batch,
        )
        .unwrap();

        assert!(report.deleted, "{:?}", report.refused);
        assert_eq!(report.outright, 2);
        assert_eq!(bin.asked.borrow().as_slice(), [root.join("Trips/boat.jpg")]);
        let mut ops: Vec<String> = journal::batch(&conn, &batch)
            .unwrap()
            .into_iter()
            .map(|entry| entry.op)
            .collect();
        ops.sort();
        assert_eq!(ops, [journal::FOLDER_DELETE, journal::ITEM_TRASH]);
        assert!(!root.join("Trips").exists());

        let back = crate::fs::undo::undo_last(&conn).unwrap().unwrap();

        assert_eq!(back.batch.batch_id, batch);
        assert!(folders::is_live(&conn, trips).unwrap());
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/boat.jpg")).unwrap(),
            "boat"
        );
        assert!(items::is_live(&conn, boat).unwrap());
        assert!(!items::is_live(&conn, pyramid).unwrap());
        assert!(!root.join("Trips/Cairo/pyramid.jpg").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_keeps_a_file_that_would_not_go_and_stays_until_it_has() {
        let (conn, root, _) = library("folder-kept");
        let lisbon = lisbon(&conn);
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        let kept = root.join("Stick/Lisbon/tram.jpg");
        let open = open_alone(&kept);

        let report = crate::fs::folders::delete(
            &conn,
            lisbon,
            Some(crate::fs::folders::Contents::Permanently),
            &journal::new_batch(),
        )
        .unwrap();
        drop(open);

        assert!(!report.deleted);
        assert_eq!(report.outright, 1);
        assert_eq!(report.refused.len(), 1);
        assert_eq!(report.refused[0].id, tram);
        settles_to(&root.join("Stick/Lisbon"), &["tram.jpg"]);
        assert!(folders::is_live(&conn, lisbon).unwrap());

        let report = crate::fs::folders::delete(
            &conn,
            lisbon,
            Some(crate::fs::folders::Contents::Permanently),
            &journal::new_batch(),
        )
        .unwrap();
        assert!(report.deleted, "{:?}", report.refused);
        assert!(!root.join("Stick/Lisbon").exists());
    }

    /// The file held open as another app holds it, so it cannot be deleted while this lives.
    #[cfg(windows)]
    fn open_alone(file: &Path) -> std::fs::File {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(file)
            .unwrap()
    }

    #[test]
    fn a_file_already_gone_from_disk_is_refused_and_nothing_else_is_touched() {
        let (conn, root, _) = library("gone");
        let tram = id_of(&conn, &["Stick", "Lisbon"], "tram.jpg");
        std::fs::remove_file(root.join("Stick/Lisbon/tram.jpg")).unwrap();

        let report = delete_items(&conn, &[tram]).unwrap();

        assert_eq!(
            report.refused[0].reason,
            Reason::NotOnDisk {
                name: "tram.jpg".into()
            }
        );
        settles_to(&root.join("Stick/Lisbon"), &["fado.mov"]);
    }
}
