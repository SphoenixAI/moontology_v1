"""Terra receives evidence unchanged through Cursor's existing MCP tool."""
import unittest
from moontology_bridge.ontology_reasoning import compact_asset, summarize_intelligence


class CursorOntology(unittest.TestCase):
    def test_four_truths_provenance_and_consequence_survive(self):
        asset = dict(id='CABLE-ROVER-01', expectedState='DEPLOYING', reportedState='ACTIVE',
                     observedState='STALLED', authoritativeState='STALLED',
                     authoritySource='GO2-01', observedProvenance='DEMO', provenance='DEMO',
                     private_controller_data='excluded')
        world = dict(assets={asset['id']: asset}, tasks={'CableDeployment-17': dict(authoritativeState='AT_RISK')},
                     missionStatus={'state': 'AT_RISK'}, events=[{'id': n} for n in range(30)],
                     discrepancies=[{'target': asset['id'], 'provenance': 'DEMO'}],
                     history_counts={'events': 30}, trustSources={'LocalLiDAR': {'trustScore': .93}})
        summary = summarize_intelligence(world)
        self.assertEqual(summary['assets'][asset['id']]['reportedState'], 'ACTIVE')
        self.assertEqual(summary['assets'][asset['id']]['authoritativeState'], 'STALLED')
        self.assertEqual(summary['assets'][asset['id']]['observedProvenance'], 'DEMO')
        self.assertNotIn('private_controller_data', summary['assets'][asset['id']])
        self.assertEqual(summary['tasks']['CableDeployment-17']['authoritativeState'], 'AT_RISK')
        self.assertEqual(len(summary['events']), 12)
        self.assertEqual(summary['history_counts']['events'], 30)
        self.assertEqual(summary['trustSources'], world['trustSources'])
        summary['assets'][asset['id']]['reportedState'] = 'CHANGED'
        self.assertEqual(asset['reportedState'], 'ACTIVE')

    def test_missing_evidence_is_not_promoted_to_authority(self):
        self.assertIsNone(summarize_intelligence(None))
        self.assertIsNone(compact_asset(None))
        self.assertNotIn('authoritativeState', compact_asset({'reportedState': 'ACTIVE'}))


if __name__ == '__main__':
    unittest.main()
