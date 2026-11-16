// ── One-off repair: November 2026 monthly word counts ────────────────────────
// Until 14 Nov 2026 a bug reset each project's monthly count to 0 whenever the
// dashboard was opened. This puts November's count back for projects that
// were CREATED in November 2026, where it is known exactly: everything ever
// added to such a project was added this month, so November's words = total.
//
//   • Only projects created on/after 1 Nov 2026 (local time) whose first log
//     entry is 0 words. Older projects are left alone (their split can't be
//     known without guessing from dates).
//   • Only changes wordsThisMonth (and lastMonthReset, set to '2026-11' as a
//     normal reset would). Never touches chapters, notes or anything else.
//   • Only ever raises the count, so running it again does nothing.
//   • Only runs during November 2026, and sync.js only calls it after the
//     device has synced successfully with the cloud.
//
// repairNovember2026(draftPunkData, now) changes the object it's given and
// returns the number of projects repaired. It doesn't save.
export function repairNovember2026(dp, now = new Date()) {
    if (now.getFullYear() !== 2026 || now.getMonth() !== 10) return 0;
    if (!dp || !dp.projects) return 0;
    const novStart = new Date(2026, 10, 1).getTime();
    let repaired = 0;
    for (const p of Object.values(dp.projects)) {
        if (!p || typeof p !== 'object') continue;
        if (!(p.createdAt >= novStart)) continue;
        const logs = Array.isArray(p.logs) ? p.logs : [];
        if (!logs.length || logs[0].total !== 0) continue;
        const total = p.total || 0;
        const monthOk = p.lastMonthReset === '2026-11';
        if (monthOk && (p.wordsThisMonth || 0) >= total) continue;
        p.wordsThisMonth = total;
        p.lastMonthReset = '2026-11';
        repaired++;
    }
    return repaired;
}
