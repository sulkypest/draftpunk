#!/usr/bin/env python3
"""
Run from /Users/ross/sulkpest/draftpunk/
Scans the PNG/ folder and outputs game-manifest.json
Re-run any time you add new assets.
"""
import os, json, re

BASE = os.path.dirname(os.path.abspath(__file__))
PNG  = os.path.join(BASE, 'PNG')

def sorted_frames(folder):
    """Return numerically sorted list of PNG paths relative to BASE."""
    if not os.path.isdir(folder):
        return []
    files = [f for f in os.listdir(folder) if f.lower().endswith('.png')]
    # Sort by the first run of digits found in the filename
    def num_key(f):
        m = re.search(r'(\d+)', f)
        return int(m.group(1)) if m else 0
    files.sort(key=num_key)
    return ['PNG/' + os.path.relpath(os.path.join(folder, f), PNG).replace('\\','/') for f in files]

def first_anim(entity_dir, candidates):
    """Return frames for the first matching animation folder."""
    for c in candidates:
        frames = sorted_frames(os.path.join(entity_dir, c))
        if frames:
            return frames
    return []

manifest = {'monsters': {}, 'bosses': {}, 'players': {}, 'deaths': {}, 'bossDeaths': {}}

# ── Monsters V1–V20 ───────────────────────────────────────────────────────────
death_pools = {
    range(1,6):   'DeathSprite',
    range(6,11):  'DeathSpriteV2',
    range(11,16): 'DeathSpriteV3',
    range(16,21): 'DeathSpriteV4',
}

for i in range(1, 21):
    key = f'MonsterV{i}'
    d   = os.path.join(PNG, key)
    if not os.path.isdir(d):
        print(f'WARNING: {key} folder not found')
        continue

    # Special case V14 — all frames in root
    if i == 14:
        root_frames = sorted_frames(d)
        manifest['monsters'][key] = {
            'Walk':   root_frames,
            'Idle':   root_frames,
            'Attack': root_frames,
        }
    else:
        walk   = first_anim(d, ['Walk', 'Moving', 'Fly'])
        idle   = first_anim(d, ['Idle'])
        attack = first_anim(d, ['Attack']) or idle   # fallback to idle if no attack
        manifest['monsters'][key] = {
            'Walk':   walk,
            'Idle':   idle,
            'Attack': attack,
            'isFlyer': os.path.isdir(os.path.join(d, 'Fly')) and not os.path.isdir(os.path.join(d, 'Walk')),
        }

    # Assign death pool
    for r, pool in death_pools.items():
        if i in r:
            manifest['monsters'][key]['deathPool'] = pool
            break

# ── Bosses 01–15 ─────────────────────────────────────────────────────────────
boss_death_pools = ['BossDeathFx1','BossDeathFx2','BossDeathFx3']

for i in range(1, 16):
    key = f'Boss{i:02d}'
    d   = os.path.join(PNG, key)
    if not os.path.isdir(d):
        print(f'WARNING: {key} folder not found')
        continue

    walk   = first_anim(d, ['Walk', 'Fly'])
    idle   = first_anim(d, ['Idle'])
    attack = first_anim(d, ['Attack']) or idle
    is_flyer = os.path.isdir(os.path.join(d, 'Fly')) and not os.path.isdir(os.path.join(d, 'Walk'))

    manifest['bosses'][key] = {
        'Walk':    walk,
        'Idle':    idle,
        'Attack':  attack,
        'isFlyer': is_flyer,
        'deathPool': boss_death_pools[(i - 1) % len(boss_death_pools)],
    }

# ── Players ───────────────────────────────────────────────────────────────────
for p in ['PlayerA', 'PlayerB', 'PlayerC', 'PlayerD']:
    d = os.path.join(PNG, p)
    if not os.path.isdir(d):
        print(f'WARNING: {p} folder not found')
        continue
    manifest['players'][p] = {
        'Walk':     first_anim(d, ['Walk']),
        'Idle':     first_anim(d, ['Idle']),
        'Attack':   first_anim(d, ['Hit', 'HamerHit', 'Run']),
        'GetHit':   first_anim(d, ['GetHit', 'Fly_getHit']),
        'Celebrate':first_anim(d, ['Celebrate', 'Celebrates']),
        'Die':      first_anim(d, ['Die']),
    }

# ── Death sprite pools ────────────────────────────────────────────────────────
for pool in ['DeathSprite','DeathSpriteV2','DeathSpriteV3','DeathSpriteV4']:
    manifest['deaths'][pool] = sorted_frames(os.path.join(PNG, pool))

for pool in ['BossDeathFx1','BossDeathFx2','BossDeathFx3']:
    manifest['bossDeaths'][pool] = sorted_frames(os.path.join(PNG, pool))

# ── Write output ──────────────────────────────────────────────────────────────
out = os.path.join(BASE, 'game-manifest.json')
with open(out, 'w') as f:
    json.dump(manifest, f, indent=2)

# Summary
print(f'Wrote {out}')
print(f'  Monsters: {len(manifest["monsters"])}')
print(f'  Bosses:   {len(manifest["bosses"])}')
print(f'  Players:  {len(manifest["players"])}')
total_frames = sum(
    len(v) for entity in [manifest['monsters'], manifest['bosses']]
    for data in entity.values()
    for k, v in data.items() if isinstance(v, list)
)
print(f'  ~{total_frames} total frame paths indexed')
