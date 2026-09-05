"""One local launch/control entry point. Default mode has no physical transport."""
from __future__ import annotations
import argparse
import fcntl
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'runtime.local'
CONTROL = 'http://127.0.0.1:8766'
# Loopback only (MapClient enforces it); override for a second dev server, e.g. replay verification on :5174.
MAP = os.environ.get('MOONTOLOGY_MAP_URL', 'http://127.0.0.1:5173/api/map')
MISSION = 'Go inspect the lunar excavator and ready it for operations.'
EXPECTED = {'dimos':'0.0.13.post1','unitree-webrtc-connect':'2.2.0'}


def request(path, body=None, timeout=20):
    req=Request(CONTROL+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        result=json.load(error)
        raise RuntimeError(result.get('error',str(result))) from error


def check_versions():
    actual={name:metadata.version(name) for name in EXPECTED}
    if actual!=EXPECTED or sys.version_info[:2]!=(3,12):
        raise RuntimeError(f'Preserved dependency baseline differs: {actual}, Python {sys.version.split()[0]}')
    return actual


def serve(mode):
    check_versions()
    from .air_runtime import AirDemo
    RUNTIME.mkdir(exist_ok=True)
    ownership=open(RUNTIME/'controller.lock','a+')
    try:
        fcntl.flock(ownership,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise RuntimeError('Another Air demo process owns the controller lock') from error
    runtime=AirDemo(mode,MAP,RUNTIME/'runs')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def reply(self,status,body):
            data=json.dumps(body).encode()
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.path=='/camera.jpg':
                sensors=runtime.backend.sensors if runtime.mode=='live' and runtime.backend else None
                if not sensors or not sensors.jpeg or time.monotonic()-sensors.camera_received>1.5:
                    return self.reply(503,{'error':'fresh_physical_camera_unavailable'})
                data=sensors.jpeg
                self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                return
            path,_,query=self.path.partition('?')
            params=dict(p.split('=',1) for p in query.split('&') if '=' in p)
            try:
                if path=='/atlas':
                    return self.reply(200,runtime.atlas_summary(params.get('scene','SCENE_1')))
                if path=='/drift':
                    return self.reply(200,runtime.scene_drift())
            except Exception as error:
                return self.reply(409,{'error':str(error)})
            if path!='/status':
                return self.reply(404,{'error':'unknown_endpoint'})
            self.reply(200,{'service':'moontology-air-demo','versions':EXPECTED,**runtime.status()})
        def do_POST(self):
            # No cross-origin browser can arm or invoke physical execution.
            if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site'):
                return self.reply(403,{'error':'native_local_operator_client_required'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<=length<=8192:
                    raise ValueError('Invalid body size')
                body=json.loads(self.rfile.read(length) or '{}')
                if self.path=='/connect':result=runtime.connect(body['ip'],body.get('sole_controller_confirmed') is True,body.get('telemetry_only') is True,body.get('posture_only') is True)
                elif self.path=='/calibrate':result=runtime.calibrate(float(body.get('scale',40)),body.get('virtual_heading'),body.get('face_waypoint') is True)
                elif self.path=='/arm':result=runtime.arm(body.get('clear_lane') is True,body.get('robot_standing') is True,body.get('recover') is True,body.get('skip_box_check') is True)
                elif self.path=='/sensor-check':result=runtime.sensor_check(body.get('stage'))
                elif self.path=='/enable-sensing':result=runtime.enable_sensing()
                elif self.path=='/enable-lidar':result=runtime.enable_lidar()
                elif self.path=='/check-avoidance':result=runtime.check_avoidance()
                elif self.path=='/stand':result=runtime.stand_in_place(body.get('clear_area') is True)
                elif self.path=='/stand-down':result=runtime.stand_down(body.get('clear_area') is True)
                elif self.path=='/diagnose-sensors':result=runtime.diagnose_sensors()
                elif self.path=='/mission':result=runtime.present(body.get('instruction',''))
                elif self.path=='/navigate':result=runtime.navigate(body.get('target_id'),body.get('max_steps',4))
                elif self.path=='/traverse':
                    if body.get('reset') is True:
                        runtime._set_traverse_progress(None);result={'ok':True,'traverse':None}
                    else:result=runtime.traverse(body.get('scene','SCENE_1'),body.get('leg'),body.get('max_steps',4),body.get('face_target',True) is not False)
                elif self.path=='/forward-test':result=runtime.forward_test()
                elif self.path=='/dimos-forward-test':result=runtime.forward_test(use_dimos=True)
                elif self.path=='/reset':result=runtime.reset()
                elif self.path=='/stop':result=runtime.stop()
                elif self.path=='/shutdown':
                    runtime.stop('shutdown')
                    threading.Thread(target=server.shutdown,daemon=True).start();result={'stopping':True}
                else:return self.reply(404,{'error':'unknown_endpoint'})
                self.reply(200,result)
            except Exception as error:
                self.reply(409,{'error':str(error)})

    server=ThreadingHTTPServer(('127.0.0.1',8766),Handler)
    def halt(*_):
        runtime.capability.stop('signal_stop');runtime.stop_event.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,halt);signal.signal(signal.SIGINT,halt)
    try:
        print(json.dumps({'service':'moontology-air-demo','mode':mode,'address':CONTROL}),flush=True)
        server.serve_forever(poll_interval=.1)
    finally:
        runtime.close();server.server_close();ownership.close()


def start(mode):
    check_versions()
    RUNTIME.mkdir(exist_ok=True)
    try:
        current=request('/status',timeout=1)
    except (URLError,TimeoutError,ConnectionError):
        current=None
    if current:
        if current.get('service')!='moontology-air-demo':
            raise RuntimeError('Port 8766 is occupied by another service')
        if current['mode']==mode:return current
        if current.get('physical_execution_available'):
            raise RuntimeError('Stop/shutdown the connected live controller before changing modes')
        request('/shutdown',{})
        time.sleep(.8)
    # Reuse the current Vite server. Start this same repo only if no server exists.
    try:
        with urlopen(MAP+'/health',timeout=1) as response:
            health=json.load(response)
            if 'publisher_connected' not in health:raise RuntimeError('5173 is not the current map server')
    except URLError:
        log=open(RUNTIME/'vite.log','ab')
        subprocess.Popen(['npm','run','dev','--','--host','127.0.0.1'],cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
        log.close()
    log=open(RUNTIME/'air-demo.log','ab')
    process=subprocess.Popen([sys.executable,'-m','moontology_bridge.air_demo','serve','--mode',mode],
        cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
    log.close()
    for _ in range(150):
        if process.poll() is not None:raise RuntimeError('Local runtime failed; inspect runtime.local/air-demo.log')
        try:return request('/status',timeout=.5)
        except (URLError,TimeoutError,ConnectionError):time.sleep(.2)
    raise RuntimeError('Local runtime startup timeout; inspect runtime.local/air-demo.log')


def replay(count):
    status=request('/status')
    if status['mode']!='replay' or status['physical_execution_available']:
        raise RuntimeError('Replay refuses a live physical process')
    results=[]
    for index in range(count):
        request('/reset',{})
        request('/calibrate',{'scale':40})
        request('/arm',{})
        request('/mission',{'instruction':MISSION})
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            status=request('/status')
            if not status['running']:break
            time.sleep(.4)
        report=status.get('report')
        if not report or not report.get('success'):
            raise RuntimeError(json.dumps({'run':index+1,'failure':report,'status':{k:v for k,v in status.items() if k!='report'}}))
        steps=report['actions'];approaches=[s for s in steps if s['action']=='approach']
        if len(approaches)<2 or not any(s['forward']>0 for s in approaches) or [s['action'] for s in steps[-3:]]!=['inspect','activate','verify']:
            raise RuntimeError('Mandatory movement/interaction sequence was not exercised')
        results.append({'run':index+1,'success':True,'elapsed_seconds':report['elapsed_seconds'],
            'approach_actions':len(approaches),'distance_start':approaches[0]['distance'],'distance_at_inspect':steps[-3]['distance'],
            'physical_development_travel_m':report['physical_travel_m'],'physical_commands_sent':report['physical_commands_sent'],
            'map_latency_ms':report['map_latency_ms'],'performance':report['final_observation'].get('performance')})
        print(json.dumps(results[-1]),flush=True)
    (RUNTIME/'replay-results.json').write_text(json.dumps(results,indent=2)+'\n')
    return {'runs':results,'final':'VERIFIED','hardware_channel':'absent'}


def wait_report(timeout=120):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        status=request('/status')
        if not status['running']:return status
        time.sleep(.4)
    request('/stop',{})
    raise RuntimeError('traverse leg exceeded timeout; STOP sent')


def traverse(scene,leg,max_steps,face_target,wait,run_all):
    """One atlas leg per arm. `--all` re-arms in software between legs and is refused for a live process."""
    status=request('/status')
    if run_all:
        if status['mode']!='replay' or status['physical_execution_available']:
            raise RuntimeError('traverse --all is a replay rehearsal; a live session arms explicitly before every leg')
        results=[]
        for _ in range(12):
            if not request('/status')['armed']:
                request('/arm',{})
            accepted=request('/traverse',{'scene':scene,'leg':leg,'max_steps':max_steps,'face_target':face_target})
            leg=None  # after an explicit first leg, continue with the next unfinished one
            report=wait_report().get('report') or {}
            results.append({k:report.get(k) for k in ('leg','target','leg_kind','sequence_label','success','arrived','error','note')}
                           |{'steps':(report.get('navigate') or {}).get('steps'),'stopped_by':(report.get('navigate') or {}).get('stopped_by'),
                             'face':(report.get('navigate') or {}).get('face'),'interactions':report.get('interactions'),
                             'pre_check':{k:v for k,v in (report.get('pre_check') or {}).items() if k in ('mobile','restaged','displacement_units','distance_units')}})
            print(json.dumps(results[-1]),flush=True)
            progress=report.get('progress') or {}
            if not report.get('success'):
                raise RuntimeError(json.dumps({'leg_failed':results[-1],'progress':progress}))
            if progress.get('scene_complete'):
                (RUNTIME/'traverse-results.json').write_text(json.dumps(results,indent=2)+'\n')
                return {'scene':scene,'legs':results,'scene_complete':True,'hardware_channel':'absent'}
        raise RuntimeError('traverse --all did not complete the scene within 12 leg runs')
    result=request('/traverse',{'scene':scene,'leg':leg,'max_steps':max_steps,'face_target':face_target})
    if wait:
        result=wait_report().get('report')
    return result


def main():
    parser=argparse.ArgumentParser(description='Air-only Moontology dimOS demo')
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('start');p.add_argument('--live',action='store_true');p.add_argument('--replay',action='store_true')
    p=sub.add_parser('serve');p.add_argument('--mode',choices=['replay','live'],required=True)
    p=sub.add_parser('replay');p.add_argument('--runs',type=int,default=3)
    p=sub.add_parser('mission');p.add_argument('instruction',nargs='?',default=MISSION)
    p=sub.add_parser('navigate',help='Bounded approach toward any map asset (e.g. H04) or layout region (e.g. Building-West); requires arm');p.add_argument('target_id');p.add_argument('--max-steps',type=int,default=4);p.add_argument('--wait',action='store_true',help='Block until the bounded navigation finishes and print its report')
    p=sub.add_parser('traverse',help='Run one pre-planned scene-atlas leg (H-01 → rover-1 → H-02 → Doorway-2A) under the current arm; re-observes mobile targets first')
    p.add_argument('--scene',default='SCENE_1');p.add_argument('--leg',type=int,help='Leg index (default: next unfinished leg)')
    p.add_argument('--max-steps',type=int,default=4);p.add_argument('--no-face',action='store_true',help='Skip the bounded turn to face the target on arrival')
    p.add_argument('--wait',action='store_true',help='Block until the leg finishes and print its report')
    p.add_argument('--all',action='store_true',help='Replay only: run every remaining leg, re-arming in software between legs')
    p.add_argument('--reset-progress',action='store_true',help='Forget completed legs and start the scene from leg 1')
    p=sub.add_parser('atlas',help='Print the boot-time scene atlas the bridge reasons with (entities, mobility, sequence, legs, pitfalls)');p.add_argument('--scene',default='SCENE_1')
    p.add_argument('--brief',action='store_true',help='Short text form used in the agent prompt')
    sub.add_parser('drift',help='Compare the live scene with the atlas: re-staged mobile assets, drifted statics, missing/unexpected ids')
    p=sub.add_parser('preflight',help='Boot-time self-check (map, atlas, bridge, hold, LCM route, LAN, agent backend); exit 1 when a required check fails')
    p.add_argument('--robot-ip');p.add_argument('--scene',default='SCENE_1');p.add_argument('--skip-atlas-build-check',action='store_true');p.add_argument('--json',action='store_true')
    p=sub.add_parser('connect');p.add_argument('--robot-ip',required=True);p.add_argument('--sole-controller-confirmed',action='store_true')
    p.add_argument('--telemetry-only',action='store_true',help='Receive real sensors; prohibit all motor commands and arming')
    p.add_argument('--posture-only',action='store_true',help='Permit one explicit stand and STOP; prohibit walking and arming')
    p=sub.add_parser('stand');p.add_argument('--clear-area',action='store_true')
    p=sub.add_parser('calibrate');p.add_argument('--scale',type=float,default=40);p.add_argument('--virtual-heading',type=float)
    p.add_argument('--face-waypoint',action='store_true',help='Map the current physical heading onto the approach bearing (straight walk, no in-place turn)')
    p=sub.add_parser('arm');p.add_argument('--clear-lane',action='store_true');p.add_argument('--robot-standing',action='store_true')
    p.add_argument('--recover',action='store_true',help='Release posture-only recovery only after all existing live sensor, clearance and map gates pass')
    p.add_argument('--skip-box-check',action='store_true',help='Operator has already completed the stationary obstacle check; LiDAR obstacle veto stays active')
    p=sub.add_parser('stand-down',help='Posture only: lower the standing robot to rest its motors (StandDown); never while armed');p.add_argument('--clear-area',action='store_true')
    p=sub.add_parser('sensor-check');p.add_argument('--stage',choices=['obstructed','clear'],required=True)
    p=sub.add_parser('wifi',help='Provision private Wi-Fi over Bluetooth; password is prompted without echo')
    p.add_argument('--ssid',required=True);p.add_argument('--name',required=True)
    p=sub.add_parser('agent',help='Run the dimOS reasoning agent (skills + MCP server + optional LLM); physical gates stay operator-only')
    p.add_argument('agent_args',nargs=argparse.REMAINDER,help='Options for moontology_bridge.agentic, e.g. --model ollama:qwen3:8b, --no-llm, --web-input')
    for command in ['reset','stop','status','shutdown','discover','enable-sensing','enable-lidar','check-avoidance','diagnose-sensors','forward-test']:sub.add_parser(command)
    # `agent` forwards its own options; argparse REMAINDER does not capture leading `--flags`.
    args,extra=parser.parse_known_args()
    if args.command!='agent' and extra:parser.error(f'unrecognized arguments: {" ".join(extra)}')
    if args.command=='serve':return serve(args.mode)
    if args.command=='start':result=start('live' if args.live else 'replay')
    elif args.command=='replay':result=replay(args.runs)
    elif args.command=='status':result=request('/status')
    elif args.command=='mission':result=request('/mission',{'instruction':args.instruction})
    elif args.command=='navigate':
        result=request('/navigate',{'target_id':args.target_id,'max_steps':args.max_steps})
        if args.wait:
            while request('/status').get('running'):time.sleep(.5)
            result=request('/status').get('report')
    elif args.command=='connect':result=request('/connect',{'ip':args.robot_ip,'sole_controller_confirmed':args.sole_controller_confirmed,'telemetry_only':args.telemetry_only,'posture_only':args.posture_only})
    elif args.command=='stand':result=request('/stand',{'clear_area':args.clear_area})
    elif args.command=='calibrate':result=request('/calibrate',{'scale':args.scale,'virtual_heading':args.virtual_heading,'face_waypoint':args.face_waypoint})
    elif args.command=='arm':result=request('/arm',{'clear_lane':args.clear_lane,'robot_standing':args.robot_standing,'recover':args.recover,'skip_box_check':args.skip_box_check})
    elif args.command=='stand-down':result=request('/stand-down',{'clear_area':args.clear_area})
    elif args.command=='sensor-check':result=request('/sensor-check',{'stage':args.stage})
    elif args.command=='traverse':
        if args.reset_progress:request('/traverse',{'reset':True})
        result=traverse(args.scene,args.leg,args.max_steps,not args.no_face,args.wait or args.all,args.all)
    elif args.command=='atlas':
        result=request(f'/atlas?scene={args.scene}')
        if args.brief:
            from .air_atlas import SceneAtlas
            print(SceneAtlas.load(MAP).agent_brief(args.scene));return
    elif args.command=='drift':result=request('/drift')
    elif args.command=='preflight':
        from .air_preflight import Preflight, render
        result=Preflight(MAP,CONTROL,args.scene,args.robot_ip,not args.skip_atlas_build_check).run(check_versions)
        if not args.json:
            print(render(result));sys.exit(0 if result['ok'] else 1)
        print(json.dumps(result,indent=2));sys.exit(0 if result['ok'] else 1)
    elif args.command=='discover':
        # Explicit next-session discovery only; never called by start/replay/preflight.
        os.execv(sys.executable,[sys.executable,'-m','dimos.robot.cli.dimos','go2tool','discover','--lan','--timeout','7'])
    elif args.command=='agent':
        # Foreground dimOS coordinator process; Ctrl-C stops it. It never touches the
        # controller lock or the WebRTC transport: all motion goes through 127.0.0.1:8766 gates.
        check_versions()
        forwarded=[a for a in [*extra,*args.agent_args] if a!='--']
        os.execv(sys.executable,[sys.executable,'-m','moontology_bridge.agentic',*forwarded])
    elif args.command=='wifi':
        # Keep credentials out of arguments, shell history, files and bridge logs.
        # The tested dimOS CLI reads the password directly with hide_input=True.
        check_versions()
        if not sys.stdin.isatty():
            raise RuntimeError('Run wifi in a local terminal for its hidden password prompt')
        os.execv(sys.executable,[sys.executable,'-m','dimos.robot.unitree.go2.cli.go2tool',
            'connect-wifi','--ssid',args.ssid,'--name',args.name,'--retries','1'])
    else:result=request('/'+args.command,{})
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr);sys.exit(1)
