export const CONFIG = {
    inspiration: [
        "SENSE SPIKE: Describe the temperature and how it affects a character's movement.",
        "GLITCH: A character says something, but their body language screams the opposite.",
        "OBJECTIVE: Introduce a physical object that will become important in 5,000 words.",
        "DIALOGUE LOCK: The next 10 lines of dialogue cannot use the word 'I' or 'Me'.",
        "PERSPECTIVE: Describe the scene from the point of view of an inanimate object.",
        "ACTION: Someone makes a sudden, irreversible decision. No going back."
    ],
    checkpoints: [
        { 
            pct: 0, name: "Opening Image", 
            tasks: [
                { label: "The 'Before' Snapshot", desc: "Show the reader exactly what the hero's life looks like before the story starts." },
                { label: "Tone Check", desc: "Ensure your first paragraph reflects the mood of the entire book (e.g., gritty vs whimsical)." }
            ]
        },
        { 
            pct: 10, name: "The Catalyst", 
            tasks: [
                { label: "Life Change", desc: "An event must occur that makes it impossible for the hero to stay in their old life." },
                { label: "The Problem", desc: "Clearly define the external threat or opportunity that has appeared." }
            ]
        },
        { 
            pct: 25, name: "Break Into Two", 
            tasks: [
                { label: "Active Choice", desc: "The hero must decide to leave their comfort zone. They aren't pushed; they jump." },
                { label: "New World", desc: "Transition the setting into a place that feels physically or emotionally different." }
            ]
        }
        // ... (Repeat structure for all 40 points)
    ],
    genreBosses: {
        urbanFantasy: ["The Dusty Cafe", "The Static Air", "The Strange Tattoo", "The Hidden Sigil", "The Alleyway Shadow", "The Coded Lamp", "The Grumpy Landlord", "The Veil Flicker", "The Council Letter", "The First Brawl", "The Unseen Wall", "The Silver Hand", "The Cryptic Text", "The Familiar Spirit", "The Night Market", "The Guard Dog", "The Golem Sentry", "The Ley Line Surge", "The Vampire Enforcer", "The Shifter Mob", "The Syndicate Boss", "The Corrupt Mage", "Memory Thief", "Ghostly Echo", "Cursed Object", "Hidden Library", "Double Agent", "Sanctuary Breach", "Waning Moon", "Ritual Site", "Blood Pact", "Dark Covenant", "Inner Demon", "Shattered Staff", "Midnight Hour", "Last Candle", "Spell of Awakening", "City's Guardian", "Dawn Bringer", "Awakened City"],
        fantasy: ["Empty Parchment", "Prophecy's Whisper", "Boring Village", "Dragon's Raid", "Crossroad Spirit", "The Gatekeeper", "Mysterious Rogue", "Enchanted Forest", "Mirror of Reversal", "Orc Battalion", "Shattered Sword", "Mourning Woods", "Ancient Forge", "Shadow Architect", "Golden Throne", "Wandering Knight", "Spore Caves", "Griffin's Nest", "The Alchemist", "Hidden Map", "Siren's Song", "Stone Troll", "Forgotten Rune", "Iron Keep", "Wizard's Tower", "The Dark Elf", "Poisoned Well", "Siege Engine", "The Wyvern", "Cursed King", "Dragon's Lair", "Obsidian Gate", "Inner Demon", "The Phoenix", "Great Spirit", "Final Stand", "Sword of Light", "Shadow Lord", "Victory Feast", "New Legend"],
        sciFi: ["Offline Console", "AI's Warning", "Rusty Outpost", "Distress Signal", "Navigation Error", "Rogue Protocol", "Alien Diplomat", "Asteroid Field", "Event Horizon", "System Virus", "Oxygen Leak", "Cold Vacuum", "Hard Reboot", "Galactic Overlord", "The Supernova", "Cryo Chamber", "Junk Trader", "Moon Base", "The Wormhole", "Star Charter", "Android Spy", "Nebula Cloud", "Gravity Well", "Ion Storm", "Plasma Core", "Black Hole", "Dyson Sphere", "Warp Drive", "Hive Mind", "Orbital Cannon", "The Mothership", "The Pulsar", "Singularity", "Solar Flare", "Time Rift", "Binary Star", "The Void", "Omega Code", "Galactic Peace", "New Frontier"],
        thriller: ["Quiet Morning", "Ominous Note", "Growing Suspicion", "First Attack", "Phone Call", "No Return", "Unexpected Ally", "High Speed Chase", "The Tracker", "Safehouse Breach", "The Mole", "Total Isolation", "The Trap", "Mastermind", "The Escape", "The Set-up", "Shadow Agency", "Encryption Key", "Double Cross", "Extraction", "Network Blackout", "Target Locked", "Deep Fake", "Cover Blown", "Safe Deposit Box", "The Hitman", "Interrogation", "The Ransom", "Ticking Clock", "Point Blank", "Ransom Note", "The Leverage", "Broken Protocol", "The Fall Guy", "Last Stand", "Confrontation", "The Reveal", "Justice Served", "Aftermath", "Case Closed"],
        horror: ["Peaceful House", "Cold Spot", "Local Legend", "First Scream", "Warning Ignored", "Locked Door", "Creeping Shadow", "False Security", "The Ritual", "Entity Revealed", "Bloody Grudge", "Darkest Night", "Ancient Evil", "The Basement", "The Attic", "Broken Mirror", "Static TV", "Ouija Board", "Shadow Figure", "Blood Writing", "The Possession", "Isolated Cabin", "Full Moon", "The Crypt", "Cemetery Gates", "The Cult", "Sacrificial Knife", "The Curse", "Urban Legend", "The Screaming", "Dark Woods", "The Fog", "Nightmare Fuel", "Final Girl", "The Survivor", "Daylight Breaks", "The Burial", "Unanswered Phone", "The Haunting", "The End?"],
        romance: ["Lonely Studio", "Friend's Advice", "Predictable Life", "Chance Encounter", "Panic Attack", "First Date", "Quirky Rival", "Honeymoon Phase", "Big Secret", "Ex's Return", "Heartbreak Engine", "Tearful Rainstorm", "Grand Gesture", "Wall of Pride", "Wedding Bells", "Awkward Hello", "Coffee Date", "Shared Umbrella", "Misread Text", "Secret Admirer", "First Kiss", "Public Scene", "Family Dinner", "Old Flame", "Misunderstanding", "Long Distance", "The Jealousy", "Compromise", "Second Chance", "The Proposal", "Love Letter", "Midnight Dance", "Sunset Walk", "Forgiveness", "The Soulmate", "Anniversary", "Happy Ever After", "New Beginning", "Forever Home", "True Love"],
        crime: ["Cold Case", "Partner's Hunch", "Routine Patrol", "Murder Scene", "Corrupt Captain", "First Interrogation", "Shady Informant", "Paper Trail", "Double Cross", "Syndicate Enforcers", "Framed Evidence", "Prison Cell", "Missing Link", "Kingpin", "Handcuffs", "Police Lineup", "Evidence Locker", "Crime Lab", "Witness Room", "District Attorney", "Search Warrant", "Stakeout", "Getaway Car", "Safe House", "Undercover Job", "The Payoff", "The Snitch", "The Smuggler", "The Heist", "The Ransom", "Police Siren", "The Courtroom", "The Jury", "The Verdict", "The Sentence", "The Parole", "Redemption", "Clean Slate", "New Life", "Justice Done"]
    }
};
