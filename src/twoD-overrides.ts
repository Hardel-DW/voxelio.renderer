export const COLORS = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink']
export const COPPER_BASES = ['copper_lantern', 'copper_chain', 'copper_door', 'copper_bars', 'copper_torch']
export const WAX_STATES = ['', 'waxed']
export const OXIDATION_STATES = ['', 'exposed', 'weathered', 'oxidized']
export const CORAL_TYPES = ['tube', 'horn', 'fire', 'brain', 'bubble']
export const SAPLING_TYPES = ['spruce', 'oak', 'birch', 'pale_oak', 'cherry', 'dark_oak', 'jungle', 'acacia', 'mangrove']
export const SINGLE_IDS = [
    'warped_roots',
    'weeping_vines',
    'torchflower',
    'vine',
    'warped_fungus',
    'twisting_vines',
    'tripwire_hook',
    'tipped_arrow',
    'torch',
    'tinted_glass',
    'tall_grass',
    'tall_dry_grass',
    'sunflower',
    'soul_torch',
    'small_amethyst_bud',
    'short_grass',
    'short_dry_grass',
    'rose_bush',
    'redstone_torch',
    'red_tulip',
    'red_mushroom',
    'recovery_compass',
    'rail',
    'powered_rail',
    'poppy',
    'pink_tulip',
    'peony',
    'oxeye_daisy',
    'orange_tulip',
    'open_eyeblossom',
    'medium_amethyst_bud',
    'lily_pad',
    'lily_of_the_valley',
    'lilac',
    'lever',
    'large_amethyst_bud',
    'large_fern',
    'hanging_roots',
    'glass_pane',
    'frogspawn',
    'fern',
    'enchanted_golden_apple',
    'detector_rail',
    'debug_stick',
    'dandelion',
    'crimson_fungus',
    'crimson_roots',
    'cornflower',
    'amethyst_cluster',
    'allium',
    'activator_rail',
    'azure_bluet',
    'brown_mushroom',
    'bush',
    'cactus_flower',
    'clock',
    'cobweb',
    'compass',
    'closed_eyeblossom',
]

interface TwoDRule {
    generate(): string[]
}

class SuffixRule implements TwoDRule {
    constructor(private readonly bases: string[], private readonly suffix: string) { }
    generate(): string[] {
        return this.bases.map(b => `${b}_${this.suffix}`)
    }
}

class PrefixComboRule implements TwoDRule {
    constructor(private readonly bases: string[], private readonly prefixGroups: string[][]) { }
    generate(): string[] {
        const out = new Set<string>()
        for (const base of this.bases) {
            const recurse = (idx: number, tokens: string[]) => {
                if (idx === this.prefixGroups.length) {
                    const nonEmpty = tokens.filter(Boolean)
                    const prefix = nonEmpty.join('_')
                    out.add(prefix ? `${prefix}_${base}` : base)
                    return
                }
                for (const p of this.prefixGroups[idx]) {
                    recurse(idx + 1, [...tokens, p])
                }
            }
            recurse(0, [])
        }
        return [...out]
    }
}

class CoralRule implements TwoDRule {
    constructor(private readonly types: string[]) { }
    generate(): string[] {
        return this.types.flatMap(t => [`${t}_coral`, `${t}_coral_fan`, `dead_${t}_coral`, `dead_${t}_coral_fan`])
    }
}

class ListRule implements TwoDRule {
    constructor(private readonly ids: string[]) { }
    generate(): string[] {
        return [...this.ids]
    }
}

export function getHardcodedTwoDItemIds(): Set<string> {
    const rules: TwoDRule[] = [
        new SuffixRule(COLORS, 'stained_glass_pane'),
        new PrefixComboRule(COPPER_BASES, [WAX_STATES, OXIDATION_STATES]),
        new CoralRule(CORAL_TYPES),
        new SuffixRule(SAPLING_TYPES, 'sapling'),
        new ListRule(SINGLE_IDS),
    ]

    const out = new Set<string>()
    for (const rule of rules) for (const id of rule.generate()) out.add(id)
    return out
}