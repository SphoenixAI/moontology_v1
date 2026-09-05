/** Research-backed tasks; assigning these jobs to humanoids is demo extrapolation. */
export const LUNAR_TASK_PROFILES: Record<string, { title: string; hardwareCheck: string; cue: string; reasoning: string; sources: readonly string[] }> = {
  H01: { title: 'ISRU regolith sampling', hardwareCheck: 'Bucket / joint dust', cue: 'Digging sample bed',
    reasoning: 'Sample feedstock → verify collection', sources: ['NASA-IPEx','NASA-MoonBase'] },
  H04: { title: 'Lunar cargo inventory', hardwareCheck: 'Cargo latch / manifest', cue: 'Writing inventory log',
    reasoning: 'Log cargo → reconcile delivery', sources: ['NASA-MoonBase','NASA-Logistics'] },
  H02: { title: 'Power connector inspection', hardwareCheck: 'Dust seal / cable feed', cue: 'Kneeling at connector',
    reasoning: 'Check connection → protect habitat power', sources: ['NASA-Connectors','NASA-MoonBase'] },
  H03: { title: 'Thermal-control review', hardwareCheck: 'Radiator dust / cooling', cue: 'Wiping-brow pause',
    reasoning: 'Pause cue → request thermal evidence', sources: ['NASA-Dust'] },
  H06: { title: 'Surface mobility recovery', hardwareCheck: 'Drive / joint response', cue: 'Slumped recovery pose',
    reasoning: 'Posture cue → verify local state', sources: ['NASA-IPEx','USSF-Trust'] },
};

export const LUNAR_RESEARCH_SOURCES = {
  'NASA-IPEx': 'https://www.nasa.gov/podcasts/small-steps-giant-leaps/small-steps-giant-leaps-episode-144-mining-the-moon-with-nasas-ipex-robot/',
  'NASA-MoonBase': 'https://www.nasa.gov/moonbase-systems/',
  'NASA-Logistics': 'https://ntrs.nasa.gov/api/citations/20220013667/downloads/Uncrewed%20LSO-Support-final1.pdf',
  'NASA-Connectors': 'https://www.nasa.gov/wp-content/uploads/2024/09/24-dust-tolerant-connectors-rev-a-508.pdf',
  'NASA-Dust': 'https://www.nasa.gov/dust-mitigation/',
  'USSF-Trust': 'https://www.spaceforce.mil/Portals/2/Documents/SAF_2026/OFD_2040_Baseline.pdf',
} as const;
