//! The trash keeping its own limits: what has outlived the time to live, then the oldest while it
//! is over its total size, goes to the Recycle Bin. DECISIONS.md "Expiry goes to the Recycle Bin".

use std::collections::HashSet;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::TrashLimits;
use crate::db::expired::{self, Gone};
use crate::db::items::{self, Tally, Waiting};
use crate::db::{in_transaction, journal};
use crate::error::Result;
use crate::fs::recycle::Bin;
use crate::fs::trash;

const DAY: i64 = 24 * 60 * 60;

/// Which of the trash's limits sent a file to the Recycle Bin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Limit {
    /// It outlived the time to live, in days.
    Age { days: u32 },
    /// It went, oldest first, to keep the trash under its total, in bytes.
    Size { bytes: i64 },
}

/// The two limits a run keeps; `None` is No Limit. Size per File is asked only at Delete.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub keep_days: Option<u32>,
    pub total_bytes: Option<i64>,
}

impl From<TrashLimits> for Limits {
    fn from(set: TrashLimits) -> Limits {
        Limits {
            keep_days: set.keep_days,
            total_bytes: set.total_gb.map(|gb| i64::from(gb) << 30),
        }
    }
}

/// What a run sent and what the bin refused, as the foot says it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Expired {
    pub by_age: u32,
    pub by_size: u32,
    pub keep_days: Option<u32>,
    pub total_bytes: Option<i64>,
    /// Every file the bin refused, which stays in the trash, and the first of them.
    pub refused: u32,
    pub first_refused: Option<i64>,
    /// Whether more were refused than at the last run, the one time the foot says so.
    pub refused_grew: bool,
}

impl Expired {
    pub fn worth_saying(&self) -> bool {
        self.by_age + self.by_size > 0 || self.refused_grew
    }
}

/// Sends what is past the limits to the Recycle Bin, one file per turn of the disk, so a restore
/// or an undo between two finds each either in the trash or gone. A file the bin refuses keeps its
/// row and its file, and still counts toward the total, so the next oldest goes in its stead.
pub fn run(conn: &Connection, bin: &dyn Bin, limits: Limits, now: i64) -> Result<Expired> {
    let mut said = Expired {
        keep_days: limits.keep_days,
        total_bytes: limits.total_bytes,
        ..Expired::default()
    };
    let mut refused = Vec::new();
    if let Some(days) = limits.keep_days {
        let before = now - i64::from(days) * DAY;
        for one in items::trash_oldest_first(conn)? {
            if one.trashed_at > before {
                break;
            }
            let _turn = super::turn();
            if items::trashed_at(conn, one.id)?.is_none_or(|at| at > before) {
                continue;
            }
            match expire(conn, bin, one.id, Limit::Age { days })? {
                Some(true) => said.by_age += 1,
                Some(false) => refused.push(one.id),
                None => {}
            }
        }
    }
    if let Some(bytes) = limits.total_bytes {
        for one in items::trash_oldest_first(conn)? {
            if refused.contains(&one.id) {
                continue;
            }
            let _turn = super::turn();
            if items::in_trash_tally(conn)?.bytes <= bytes {
                break;
            }
            match expire(conn, bin, one.id, Limit::Size { bytes })? {
                Some(true) => said.by_size += 1,
                Some(false) => refused.push(one.id),
                None => {}
            }
        }
    }
    let before = expired::refused(conn)?.len();
    expired::set_refused(conn, &refused)?;
    said.refused = refused.len() as u32;
    said.first_refused = refused.first().copied();
    said.refused_grew = refused.len() > before;
    Ok(said)
}

/// Sends one trashed file to the Recycle Bin and, once it has gone, forgets its row, recording
/// what it was; `None` when it is no longer in the trash, `Some(false)` when the bin refused it.
fn expire(conn: &Connection, bin: &dyn Bin, item_id: i64, limit: Limit) -> Result<Option<bool>> {
    if !items::is_trashed(conn, item_id)? {
        return Ok(None);
    }
    let Some(file) = items::file_of(conn, item_id)? else {
        return Ok(None);
    };
    if !trash::send_trashed(bin, &file)? {
        return Ok(Some(false));
    }
    let gone = Gone {
        item_id,
        name: file.disk_name,
        folder_id: file.folder_id,
        limit,
    };
    in_transaction(conn, |tx| {
        expired::record(tx, &gone)?;
        journal::expire_item(tx, &gone)?;
        items::forget_trashed(tx, item_id)
    })?;
    Ok(Some(true))
}

/// What the next run would send, if the bin refuses nothing new: by age as of `at`, then by size.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Due {
    pub by_age: Tally,
    pub by_size: Tally,
}

/// What a run at `at` would send. A file the bin refused at the last run is left out of it, and
/// still counts toward the total, as the run would find.
pub fn due(conn: &Connection, limits: Limits, at: i64) -> Result<Due> {
    let refused: HashSet<i64> = expired::refused(conn)?.into_iter().collect();
    let waiting = items::trash_oldest_first(conn)?;
    let mut total: i64 = waiting.iter().map(|one| one.bytes).sum();
    let mut due = Due::default();
    let mut taken = HashSet::new();
    if let Some(days) = limits.keep_days {
        let before = at - i64::from(days) * DAY;
        for one in waiting.iter().filter(|one| one.trashed_at <= before) {
            if !refused.contains(&one.id) {
                add(&mut due.by_age, one);
                total -= one.bytes;
                taken.insert(one.id);
            }
        }
    }
    if let Some(bytes) = limits.total_bytes {
        for one in &waiting {
            if total <= bytes {
                break;
            }
            if !refused.contains(&one.id) && !taken.contains(&one.id) {
                add(&mut due.by_size, one);
                total -= one.bytes;
            }
        }
    }
    Ok(due)
}

fn add(tally: &mut Tally, one: &Waiting) {
    tally.count += 1;
    tally.bytes += one.bytes;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders, tags};
    use crate::error::Reason;
    use crate::fs::recycle::tests::{Fake, Stand};
    use crate::fs::stayed::Whereabouts;
    use crate::fs::{acts, paths, undo, walk};
    use std::path::{Path, PathBuf};

    const NOW: i64 = 1_800_000_000;
    const GB: i64 = 1 << 30;

    struct Library {
        conn: Connection,
        dir: PathBuf,
        cairo: i64,
    }

    /// Trips/Cairo holding the files named, walked into a real file, in a folder of its own.
    fn library(name: &str, files: &[&str]) -> Library {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-expiry")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        for file in files {
            std::fs::write(root.join("Trips/Cairo").join(file), *file).unwrap();
        }
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        Library { conn, dir, cairo }
    }

    impl Library {
        fn id(&self, name: &str) -> i64 {
            items::existing_by_disk_name(&self.conn, self.cairo, name)
                .unwrap()
                .unwrap()
                .id
        }

        /// Sends each file to the trash in a batch of its own, `days` ago and `bytes` large.
        fn trashed(&self, files: &[(&str, i64, i64)]) -> Vec<(i64, String)> {
            files
                .iter()
                .map(|&(name, days, bytes)| {
                    let id = self.id(name);
                    let batch = journal::new_batch();
                    trash::trash_items(&self.conn, &[id], &batch).unwrap();
                    self.age(id, days, bytes);
                    (id, batch)
                })
                .collect()
        }

        fn age(&self, id: i64, days: i64, bytes: i64) {
            items::set_trashed_at(&self.conn, id, NOW - days * DAY).unwrap();
            self.conn
                .execute(
                    "UPDATE item SET size_bytes = ?1 WHERE id = ?2",
                    rusqlite::params![bytes, id],
                )
                .unwrap();
        }

        fn bin(&self) -> Fake {
            Fake::new(Stand::Recycles(self.dir.join("bin")))
        }

        fn in_bin(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(self.dir.join("bin"))
                .map(|entries| {
                    entries
                        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            names.sort();
            names
        }

        fn trash_file(&self, id: i64) -> PathBuf {
            let file = items::file_of(&self.conn, id).unwrap().unwrap();
            paths::trash_path(&file.uuid, &file.disk_name).unwrap()
        }

        fn trash_name(&self, id: i64) -> String {
            let path = self.trash_file(id);
            path.file_name().unwrap().to_string_lossy().into_owned()
        }

        /// Takes what a test left in the shared trash out of it.
        fn clear(&self, ids: &[i64]) {
            for &id in ids {
                std::fs::remove_file(self.trash_file(id)).unwrap();
            }
        }
    }

    fn limits(keep_days: Option<u32>, total_bytes: Option<i64>) -> Limits {
        Limits {
            keep_days,
            total_bytes,
        }
    }

    #[test]
    fn what_has_outlived_the_time_to_live_goes_to_the_recycle_bin_and_the_rest_waits() {
        let lib = library("age", &["old.jpg", "older.jpg", "new.jpg"]);
        let ids = lib.trashed(&[("old.jpg", 31, 1), ("older.jpg", 40, 1), ("new.jpg", 29, 1)]);
        let mut sent = vec![lib.trash_name(ids[0].0), lib.trash_name(ids[1].0)];
        sent.sort();

        let said = run(&lib.conn, &lib.bin(), limits(Some(30), None), NOW).unwrap();

        assert_eq!((said.by_age, said.by_size, said.refused), (2, 0, 0));
        assert!(said.worth_saying());
        assert_eq!(lib.in_bin(), sent);
        assert!(items::file_of(&lib.conn, ids[0].0).unwrap().is_none());
        assert!(items::is_trashed(&lib.conn, ids[2].0).unwrap());
        assert!(lib.trash_file(ids[2].0).is_file());
        assert_eq!(
            expired::of(&lib.conn, ids[1].0).unwrap().unwrap().limit,
            Limit::Age { days: 30 }
        );
        lib.clear(&[ids[2].0]);
    }

    #[test]
    fn over_its_total_the_trash_sends_the_oldest_first_until_it_is_under() {
        let lib = library("size", &["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
        let ids = lib.trashed(&[
            ("a.jpg", 3, GB),
            ("b.jpg", 5, 2 * GB),
            ("c.jpg", 1, GB),
            ("d.jpg", 4, GB),
        ]);
        let total = limits(None, Some(2 * GB));
        assert_eq!(
            due(&lib.conn, total, NOW).unwrap().by_size,
            Tally {
                count: 2,
                bytes: 3 * GB
            }
        );

        let said = run(&lib.conn, &lib.bin(), total, NOW).unwrap();

        assert_eq!((said.by_age, said.by_size), (0, 2));
        let left: Vec<i64> = items::trash_oldest_first(&lib.conn)
            .unwrap()
            .iter()
            .map(|one| one.id)
            .collect();
        assert_eq!(left, [ids[0].0, ids[2].0], "b, then d, went: the oldest");
        assert_eq!(
            expired::of(&lib.conn, ids[1].0).unwrap().unwrap().limit,
            Limit::Size { bytes: 2 * GB }
        );
        lib.clear(&[ids[0].0, ids[2].0]);
    }

    #[test]
    fn a_run_sends_by_age_first_then_by_size_and_size_per_file_is_never_its_limit() {
        let lib = library("both", &["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
        let ids = lib.trashed(&[
            ("a.jpg", 45, GB),
            ("b.jpg", 10, 6 * GB),
            ("c.jpg", 8, GB),
            ("d.jpg", 2, GB),
        ]);
        let both = limits(Some(30), Some(GB));
        let plan = due(&lib.conn, both, NOW).unwrap();
        assert_eq!((plan.by_age.count, plan.by_size.count), (1, 2));

        let said = run(&lib.conn, &lib.bin(), both, NOW).unwrap();

        assert_eq!((said.by_age, said.by_size), (1, 2));
        assert_eq!((said.keep_days, said.total_bytes), (Some(30), Some(GB)));
        assert!(
            items::is_trashed(&lib.conn, ids[3].0).unwrap(),
            "the newest stays, as large as the total"
        );
        assert_eq!(due(&lib.conn, both, NOW).unwrap(), Due::default());
        lib.clear(&[ids[3].0]);
    }

    #[test]
    fn a_lowered_limit_sends_nothing_until_the_run_and_says_what_it_will_send() {
        let lib = library("lowered", &["a.jpg", "b.jpg"]);
        let ids = lib.trashed(&[("a.jpg", 10, 3), ("b.jpg", 2, 5)]);
        let week = limits(Some(7), None);

        assert_eq!(
            due(&lib.conn, week, NOW).unwrap().by_age,
            Tally { count: 1, bytes: 3 }
        );
        assert_eq!(
            due(&lib.conn, week, NOW + 6 * DAY).unwrap().by_age.count,
            2,
            "as of when the run is"
        );
        assert!(lib.trash_file(ids[0].0).is_file());
        lib.clear(&[ids[0].0, ids[1].0]);
    }

    #[test]
    fn with_no_limits_nothing_leaves_the_trash() {
        let lib = library("none", &["a.jpg"]);
        let ids = lib.trashed(&[("a.jpg", 900, 300 * GB)]);
        let bin = lib.bin();

        let said = run(&lib.conn, &bin, limits(None, None), NOW).unwrap();

        assert!(!said.worth_saying());
        assert!(bin.asked.borrow().is_empty());
        lib.clear(&[ids[0].0]);
    }

    #[test]
    fn a_file_the_recycle_bin_cannot_take_is_never_deleted_and_stays_in_the_trash_counted() {
        let lib = library("refused", &["a.jpg", "b.jpg", "c.jpg"]);
        let ids = lib.trashed(&[("a.jpg", 50, 2 * GB), ("b.jpg", 9, GB), ("c.jpg", 1, GB)]);
        let refused = lib.trash_file(ids[0].0);
        let mut bin = lib.bin();
        bin.deletes = vec![lib.trash_name(ids[0].0)];
        let both = limits(Some(30), Some(3 * GB));

        let said = run(&lib.conn, &bin, both, NOW).unwrap();

        assert_eq!((said.by_age, said.by_size, said.refused), (0, 1, 1));
        assert_eq!(said.first_refused, Some(ids[0].0));
        assert!(said.refused_grew);
        assert_eq!(std::fs::read_to_string(&refused).unwrap(), "a.jpg");
        assert!(items::is_trashed(&lib.conn, ids[0].0).unwrap());
        assert!(
            !items::is_trashed(&lib.conn, ids[1].0).unwrap(),
            "the refused file still counts, so the next oldest went in its stead"
        );
        assert_eq!(
            due(&lib.conn, both, NOW).unwrap(),
            Due::default(),
            "what the bin refused is not said to be going"
        );

        let again = run(&lib.conn, &bin, both, NOW).unwrap();
        assert_eq!((again.refused, again.refused_grew), (1, false));
        assert!(!again.worth_saying(), "tried again without a word");
        assert_eq!(bin.asked.borrow().len(), 3, "and tried again at each run");
        assert!(refused.is_file());

        bin.deletes.push(lib.trash_name(ids[2].0));
        let more = run(&lib.conn, &bin, limits(Some(0), None), NOW).unwrap();
        assert_eq!((more.refused, more.refused_grew), (2, true));
        lib.clear(&[ids[0].0, ids[2].0]);
    }

    #[test]
    fn a_restore_that_loses_the_race_says_the_file_is_in_the_recycle_bin_and_the_rest_restore() {
        let lib = library("restore-race", &["old.jpg", "new.jpg"]);
        let ids = lib.trashed(&[("old.jpg", 31, 1), ("new.jpg", 1, 1)]);
        run(&lib.conn, &lib.bin(), limits(Some(30), None), NOW).unwrap();

        let both = [ids[0].0, ids[1].0];
        let report = trash::restore_items(&lib.conn, &both, None, &journal::new_batch()).unwrap();

        assert_eq!(report.restored, 1);
        let [gone] = report.refused.as_slice() else {
            panic!("{:?}", report.refused)
        };
        assert_eq!((gone.id, gone.name.as_str()), (ids[0].0, "old.jpg"));
        assert_eq!(gone.at, Whereabouts::RecycleBin);
        assert_eq!(
            gone.reason,
            Reason::Expired {
                limit: Limit::Age { days: 30 }
            }
        );
        assert!(lib.dir.join("library/Trips/Cairo/new.jpg").is_file());
    }

    #[test]
    fn an_undo_reaching_expired_files_says_where_they_went_and_drops_their_rows() {
        let lib = library("undo-race", &["a.jpg", "b.jpg", "c.jpg"]);
        let (a, b) = (lib.id("a.jpg"), lib.id("b.jpg"));
        let pair = journal::new_batch();
        trash::trash_items(&lib.conn, &[a, b], &pair).unwrap();
        lib.age(a, 60, 1);
        lib.age(b, 0, 1);
        let alone = lib.trashed(&[("c.jpg", 60, 1)]);
        run(&lib.conn, &lib.bin(), limits(Some(30), None), NOW).unwrap();

        let part = undo::undo_batch(&lib.conn, &pair).unwrap();
        let cairo = Some("Cairo".to_string());
        assert_eq!(
            part.batch.act,
            acts::Act::Delete {
                from: cairo.clone(),
                one: None
            }
        );
        assert_eq!((part.batch.files, part.files_back), (2, 1));
        assert_eq!(part.stayed.len(), 1);
        assert_eq!(part.stayed[0].id, a);
        assert_eq!(part.stayed[0].at, Whereabouts::RecycleBin);
        assert!(lib.dir.join("library/Trips/Cairo/b.jpg").is_file());
        assert!(journal::batch(&lib.conn, &pair).unwrap().is_empty());

        let all = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(all.batch.batch_id, alone[0].1);
        assert_eq!(
            all.batch.act,
            acts::Act::Delete {
                from: cairo,
                one: Some("c.jpg".into())
            }
        );
        assert_eq!(all.files_back, 0);
        assert_eq!(
            all.stayed[0].reason,
            Reason::Expired {
                limit: Limit::Age { days: 30 }
            }
        );
        assert_eq!(
            undo::undo_last(&lib.conn).unwrap(),
            None,
            "said once, then gone"
        );
    }

    #[test]
    fn an_expired_file_leaves_every_row_about_several_and_a_row_left_with_none_goes() {
        let lib = library("prune", &["a.jpg", "b.jpg"]);
        let (a, b) = (lib.id("a.jpg"), lib.id("b.jpg"));
        let pair = journal::new_batch();
        tags::add_items_tag(&lib.conn, &[a, b], "dusk", &pair).unwrap();
        let lone = journal::new_batch();
        tags::add_items_tag(&lib.conn, &[a], "dawn", &lone).unwrap();
        lib.trashed(&[("a.jpg", 31, 1)]);

        run(&lib.conn, &lib.bin(), limits(Some(30), None), NOW).unwrap();

        let rows = journal::batch(&lib.conn, &pair).unwrap();
        let tagged: journal::ItemsTagged = serde_json::from_value(rows[0].inverse.clone()).unwrap();
        assert_eq!(tagged.item_ids, [b]);
        assert!(journal::batch(&lib.conn, &lone).unwrap().is_empty());
        let acting: i64 = lib
            .conn
            .query_row(
                "SELECT COUNT(*) FROM journal
                  WHERE json_extract(inverse, '$.itemId') = ?1
                    AND json_extract(inverse, '$.expired') IS NULL",
                [a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(acting, 0, "no row acts on its id again");
    }
}
