// ── Chapter merge on sign-in ─────────────────────────────────────────────────
// When the Write page loads for a signed-in writer, this device's chapters and
// the cloud's chapters for the same project are combined ONE CHAPTER AT A
// TIME, so an edit made on one device can't wipe out an edit to a different
// chapter made on another.
//
// Rules (never throw text away):
//   • chapter in both places  → keep whichever copy was changed most recently
//                               (a tie keeps this device's copy)
//   • chapter only on this device → keep it, and send it to the cloud (it was
//                               written offline, or its cloud save failed)
//   • chapter only in the cloud   → keep it (written on another device)
//
// Returns:
//   chapters    the merged list, in chapter order
//   toPush      chapters whose copy on this device is the one kept, and which
//               the cloud doesn't already have in that form
//   replaced    chapters where this device's text is being replaced by a newer
//               cloud copy and differs from it (save these as a version first)
//   changed     true if the merged list differs from this device's list
//
// A chapter deleted on another device but still here will come back, because
// this device can't tell "deleted elsewhere" from "written offline". That is
// deliberate: bringing back a chapter is recoverable, losing one isn't.

(function (root) {
    function t(ch) { return (ch && ch.updatedAt) || 0; }

    function merge(localChapters, cloudChapters) {
        const local = Array.isArray(localChapters) ? localChapters : [];
        const cloud = Array.isArray(cloudChapters) ? cloudChapters : [];
        const cloudById = {};
        cloud.forEach(c => { if (c && c.id) cloudById[c.id] = c; });
        const localIds = new Set();

        const merged = [], toPush = [], replaced = [];
        let changed = false;

        local.forEach(l => {
            if (!l || !l.id) return;
            localIds.add(l.id);
            const c = cloudById[l.id];
            if (!c) {                       // only on this device
                merged.push(l);
                toPush.push(l);
                return;
            }
            if (t(c) > t(l)) {              // the cloud copy is newer
                merged.push(c);
                if ((c.content || '') !== (l.content || '') || (c.title || '') !== (l.title || '')) {
                    replaced.push(l);
                }
                changed = true;
            } else {                        // this device's copy is newer or the same age
                merged.push(l);
                if (t(l) > t(c)) toPush.push(l);
            }
        });

        cloud.forEach(c => {                // only in the cloud
            if (!c || !c.id || localIds.has(c.id)) return;
            merged.push(c);
            changed = true;
        });

        // Chapter order: by each chapter's stored position; where two share a
        // position (e.g. one added on each device), the older one comes first.
        const sorted = merged.slice().sort((a, b) => ((a.order || 0) - (b.order || 0)) || (t(a) - t(b)));
        if (!changed) changed = sorted.some((ch, i) => ch !== local[i]);

        return { chapters: sorted, toPush, replaced, changed };
    }

    const api = { merge };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.DPChapterMerge = api;
})(this);
