"""Read-only projections for Cursor's reasoner; no reconciliation or robot I/O."""
from copy import deepcopy

ASSET_FIELDS = ('id', 'assetType', 'expectedState', 'reportedState', 'observedState',
                'authoritativeState', 'authoritySource', 'provenance', 'reportedSource',
                'reportedProvenance', 'lastReportedAt', 'observedSource', 'observedProvenance',
                'lastObservedAt', 'observationConfidence', 'motionState', 'health',
                'batteryOrPower', 'assignedTask', 'blockedBy', 'dependencies', 'available',
                'location', 'reportedLocation', 'observedLocation')


def compact_asset(asset):
    if not isinstance(asset, dict):
        return None
    return deepcopy({key: asset[key] for key in ASSET_FIELDS if key in asset})


def summarize_intelligence(world):
    """Preserve canonical truth and provenance inside the existing observe_scene tool.

    Missing evidence stays missing. Recent log windows are bounded; history counts
    tell the reasoner when it is seeing only part of the session's evidence.
    """
    if not isinstance(world, dict):
        return None
    result = {key: deepcopy(world[key]) for key in ('now', 'revision', 'missionStatus',
              'resources', 'robotResources', 'resourceSites', 'trustSources', 'networkPaths',
              'environmentEvents') if key in world}
    for family in ('assets', 'tasks', 'facilities', 'powerNodes', 'routes'):
        result[family] = {key: compact_asset(value) for key, value in (world.get(family) or {}).items()}
    for family in ('observations', 'events', 'discrepancies'):
        result[family] = deepcopy((world.get(family) or [])[-12:])
    result['history_counts'] = deepcopy(world.get('history_counts') or world.get('historyCounts') or {})
    result['reasoning_boundary'] = (
        'Terra plans and explains using these canonical states. Reports are claims; '
        'DEMO observations are simulated. The ontology reconciles authority deterministically. '
        'Model inference is not measured evidence. dimOS owns bounded execution and safety gates.'
    )
    return result
