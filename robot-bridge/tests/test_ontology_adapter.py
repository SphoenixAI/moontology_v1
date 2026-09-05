"""Semantic adapter contract only. No dimOS import, hardware, or socket startup."""
import unittest
from unittest.mock import patch
from moontology_bridge.air_core import MapClient, GateError


class OntologyAdapterContract(unittest.TestCase):
    def test_perception_reuses_existing_read_token_and_preserves_provenance(self):
        client = MapClient()
        calls = []

        def call(path, body=None):
            calls.append((path, body))
            client.response = {'ok': True, 'read_token': 'current-scene-read',
                               'observation': {'scene_session_id': 'presentation-session'}}
            return client.response

        with patch.object(client, '_call', side_effect=call):
            client.submit_perception(sample_id='perception-7', source='GO2-01',
                                     target='CABLE-ROVER-01', metric='reel_rotation',
                                     value=0, confidence=.94, timestamp_ms=12345,
                                     provenance='DEMO')
        self.assertEqual([p for p, _ in calls], ['observation', 'intelligence'])
        payload = calls[-1][1]
        self.assertEqual(payload['read_token'], 'current-scene-read')
        self.assertTrue(payload['command_id'])
        self.assertEqual(payload['observation']['source'], 'GO2-01')
        self.assertEqual(payload['observation']['provenance'], 'DEMO')
        self.assertNotIn('authoritativeState', payload['observation'])

    def test_ambiguous_provenance_is_rejected_before_io(self):
        client = MapClient()
        with patch.object(client, '_call') as call:
            with self.assertRaises(GateError):
                client.report_asset('CABLE-ROVER-01', 'ACTIVE', provenance='REALISH')
            call.assert_not_called()

    def test_remote_loopback_assumption_remains_forbidden(self):
        with self.assertRaises(GateError):
            MapClient('http://10.0.0.202:5173/api/map')


if __name__ == '__main__':
    unittest.main()
