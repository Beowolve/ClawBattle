function serializeColors(colors) {
  return JSON.stringify(Array.isArray(colors) ? colors : []);
}

export function upsertBattleTarget(db, t) {
  db.prepare(`
    INSERT INTO battle_targets (id, name, image_url, colors, battle_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      image_url  = excluded.image_url,
      colors     = excluded.colors,
      battle_number = excluded.battle_number,
      updated_at = excluded.updated_at
  `).run(t.id, t.name, t.image_url, serializeColors(t.colors), t.battle_number, t.created_at, t.updated_at);
}

export function upsertDailyTarget(db, t) {
  db.prepare(`
    INSERT INTO daily_targets (key, name, image_url, colors, date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name       = excluded.name,
      image_url  = excluded.image_url,
      colors     = excluded.colors,
      date       = excluded.date,
      updated_at = excluded.updated_at
  `).run(t.key, t.name, t.image_url, serializeColors(t.colors), t.date, t.created_at, t.updated_at);
}

export function getBattleTargets(db) {
  return db.prepare('SELECT * FROM battle_targets ORDER BY battle_number ASC').all()
    .map(r => ({ ...r, colors: JSON.parse(r.colors) }));
}

export function getDailyTargets(db) {
  return db.prepare('SELECT * FROM daily_targets ORDER BY date DESC').all()
    .map(r => ({ ...r, colors: JSON.parse(r.colors) }));
}
