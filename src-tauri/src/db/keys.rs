//! Destination keys: a digit bound to a folder, pressed to move files there. docs/SCHEMA.md
//! "Destination keys".

use rusqlite::{Connection, params};

use crate::db::folders;
use crate::error::{AppError, Result};

/// One binding as it stands: whether its folder is still live, and how many files that folder
/// holds directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub key: String,
    pub folder_id: i64,
    /// Retired by a delete or a walk: the key is kept, because an undo can bring the folder back.
    pub gone: bool,
    pub item_count: i64,
}

/// Every binding, in the order the keys sit on the keyboard: 1 to 9, then 0.
pub fn list(conn: &Connection) -> Result<Vec<Binding>> {
    let mut stmt = conn.prepare(
        "SELECT k.key, k.folder_id, f.deleted_at IS NOT NULL,
                (SELECT COUNT(*) FROM item i WHERE i.folder_id = f.id AND i.deleted_at IS NULL)
           FROM destination_key k JOIN folder f ON f.id = k.folder_id
          ORDER BY k.key = '0', k.key",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Binding {
                key: r.get(0)?,
                folder_id: r.get(1)?,
                gone: r.get(2)?,
                item_count: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn digit(key: &str) -> Result<()> {
    if key.len() == 1 && key.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "{key:?} is not a destination key"
        )))
    }
}

/// Binds a key to a folder. A key another folder held moves here, and a key this folder held is
/// freed, since a folder has one key at most. Neither is asked about.
pub fn set(conn: &Connection, key: &str, folder_id: i64) -> Result<()> {
    digit(key)?;
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM destination_key WHERE key = ?1 OR folder_id = ?2",
        params![key, folder_id],
    )?;
    tx.execute(
        "INSERT INTO destination_key (key, folder_id) VALUES (?1, ?2)",
        params![key, folder_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Frees a key. Freeing one that is already free does nothing.
pub fn remove(conn: &Connection, key: &str) -> Result<()> {
    digit(key)?;
    conn.execute("DELETE FROM destination_key WHERE key = ?1", params![key])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO source (id, root, title, kind, added_at) VALUES (1, 'D:/Pictures', 'Pictures', 'library', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO folder (id, title, parent_id, source_id, created_at) VALUES (1, 'Pictures', NULL, 1, 0)",
            [],
        )
        .unwrap();
        for (id, title) in [(2, "Lisbon"), (3, "Cairo")] {
            conn.execute(
                "INSERT INTO folder (id, title, parent_id, created_at) VALUES (?1, ?2, 1, 0)",
                params![id, title],
            )
            .unwrap();
        }
        conn
    }

    fn keys(conn: &Connection) -> Vec<(String, i64)> {
        list(conn)
            .unwrap()
            .into_iter()
            .map(|one| (one.key, one.folder_id))
            .collect()
    }

    #[test]
    fn keys_list_in_keyboard_order_with_zero_last() {
        let conn = conn();
        set(&conn, "0", 2).unwrap();
        set(&conn, "1", 3).unwrap();
        assert_eq!(keys(&conn), [("1".into(), 3), ("0".into(), 2)]);
    }

    #[test]
    fn binding_a_held_key_moves_it_and_a_second_key_frees_the_first() {
        let conn = conn();
        set(&conn, "1", 2).unwrap();
        set(&conn, "1", 3).unwrap();
        assert_eq!(keys(&conn), [("1".into(), 3)], "the key moved to Cairo");
        set(&conn, "2", 3).unwrap();
        assert_eq!(
            keys(&conn),
            [("2".into(), 3)],
            "Cairo holds one key at most"
        );
    }

    #[test]
    fn only_a_digit_is_a_key_and_only_a_live_folder_takes_one() {
        let conn = conn();
        assert!(set(&conn, "a", 2).is_err());
        assert!(set(&conn, "12", 2).is_err());
        assert!(remove(&conn, "").is_err());
        conn.execute("UPDATE folder SET deleted_at = 1 WHERE id = 3", [])
            .unwrap();
        assert!(set(&conn, "1", 3).is_err());
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn a_retired_folder_keeps_its_key_marked_gone_and_counts_only_live_files() {
        let conn = conn();
        set(&conn, "4", 2).unwrap();
        for (name, deleted) in [("a.jpg", None), ("b.jpg", Some(1))] {
            conn.execute(
                "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime, kind, added_at, deleted_at)
                 VALUES (?1, 1, 2, ?1, 'jpg', 1, 0, 'image', 0, ?2)",
                params![name, deleted],
            )
            .unwrap();
        }
        let [live] = list(&conn).unwrap().try_into().unwrap();
        assert_eq!((live.gone, live.item_count), (false, 1));

        conn.execute("UPDATE folder SET deleted_at = 1 WHERE id = 2", [])
            .unwrap();
        let [gone] = list(&conn).unwrap().try_into().unwrap();
        assert!(gone.gone, "kept, and marked");
    }

    #[test]
    fn a_folder_deleted_outright_takes_its_key() {
        let conn = conn();
        set(&conn, "1", 2).unwrap();
        conn.execute("DELETE FROM folder WHERE id = 2", []).unwrap();
        assert!(keys(&conn).is_empty());
    }

    #[test]
    fn freeing_a_key_drops_it_and_freeing_it_again_does_nothing() {
        let conn = conn();
        set(&conn, "1", 2).unwrap();
        remove(&conn, "1").unwrap();
        remove(&conn, "1").unwrap();
        assert!(keys(&conn).is_empty());
    }
}
