/** Small guest-side supervisor shared by Fly and exe.dev execution backends. */
export const FACTORIZE_JOB_LAUNCHER = String.raw`#!/usr/bin/env python3
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path('/home/exedev/.factorize-job')
PAYLOAD = ROOT / 'launch.json'
STATE = ROOT / 'process.json'
RESULT = ROOT / 'results.json'
LOG = pathlib.Path('/tmp/factorize.log')
ERR = pathlib.Path('/tmp/factorize.stderr')

def save(path, value):
    fd, temp = tempfile.mkstemp(prefix='.factorize-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        try: os.unlink(temp)
        except FileNotFoundError: pass

def load_payload():
    raw = sys.stdin.buffer.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('launch payload exceeds 32 MiB')
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('unsupported launch payload')
    if ('code' in value) == ('harness' in value):
        raise ValueError('launch payload must contain code or harness')
    return value

def child_command(payload):
    env = os.environ.copy()
    env['FACTORIZE_RESULT_PATH'] = str(RESULT)
    if 'code' in payload:
        code = payload['code']
        if not isinstance(code, dict) or not isinstance(code.get('script'), str) or not isinstance(code.get('context'), dict):
            raise ValueError('invalid code launch payload')
        script = ROOT / 'job.sh'
        script.write_text(code['script'], encoding='utf-8')
        script.chmod(0o700)
        (ROOT / 'input.json').write_text(json.dumps(code['context']), encoding='utf-8')
        env['FACTORIZE_INPUT_PATH'] = str(ROOT / 'input.json')
        return ['/bin/bash', str(script)], b'', env
    harness = payload['harness']
    if not isinstance(harness, dict) or not isinstance(harness.get('executable'), str) or not harness['executable'] or '\x00' in harness['executable'] or not isinstance(harness.get('args'), list):
        raise ValueError('invalid agent launch payload')
    if not all(isinstance(arg, str) and '\x00' not in arg for arg in harness['args']):
        raise ValueError('invalid agent arguments')
    for name, value in harness.get('env', {}).items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) or not isinstance(value, str) or '\x00' in value:
            raise ValueError('invalid agent environment')
        env[name] = value
    env['FACTORIZE_RESULT_PATH'] = str(RESULT)
    return [harness['executable'], *harness['args']], str(payload.get('prompt', '')).encode(), env

def launch(foreground=False):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if STATE.exists():
        current = json.loads(STATE.read_text())
        pid = current.get('pid')
        if isinstance(pid, int):
            try: os.kill(pid, 0)
            except ProcessLookupError: pass
            else: raise RuntimeError('a Factorize job is already active')
    payload = load_payload()
    source = payload.get('traceSources', {}).get('primary', {})
    trace_path = source.get('path') if source.get('kind') == 'execution_stream' else None
    if trace_path:
        trace = pathlib.PurePosixPath(trace_path)
        if not trace.is_absolute() or '..' in trace.parts:
            raise ValueError('invalid execution trace path')
        pathlib.Path(trace).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        pathlib.Path(trace).touch(mode=0o600, exist_ok=True)
    command, stdin, env = child_command(payload)
    PAYLOAD.write_text(json.dumps({key: value for key, value in payload.items() if key != 'prompt'}), encoding='utf-8')
    input_path = ROOT / 'prompt.txt'
    input_path.write_bytes(stdin)
    save(STATE, {'state': 'starting'})
    stdout_path = pathlib.Path(trace_path) if trace_path else LOG
    if foreground:
        save(STATE, {'state': 'running', 'pid': os.getpid()})
        try:
            with input_path.open('rb') as input_stream:
                result = subprocess.run(command, stdin=input_stream, env=env, check=False)
            save(STATE, {'state': 'exited', 'exitCode': result.returncode})
            raise SystemExit(result.returncode)
        except BaseException as error:
            if isinstance(error, SystemExit): raise
            save(STATE, {'state': 'exited', 'exitCode': 127, 'error': str(error)[:500]})
            raise
    with stdout_path.open('ab', buffering=0) as stdout, ERR.open('ab', buffering=0) as stderr:
        process = subprocess.Popen([sys.executable, __file__, '_run', json.dumps(command), str(input_path)], stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, env=env, start_new_session=True, close_fds=True)
    save(STATE, {'state': 'running', 'pid': process.pid})
    process.stdin.write(b'go\n')
    process.stdin.close()
    print('started')

def run(command, input_path):
    try:
        if not sys.stdin.buffer.readline():
            raise RuntimeError('launcher did not confirm process ownership')
        with open(input_path, 'rb') as input_stream:
            result = subprocess.run(command, stdin=input_stream, check=False)
        save(STATE, {'state': 'exited', 'exitCode': result.returncode})
        raise SystemExit(result.returncode)
    except BaseException as error:
        if isinstance(error, SystemExit): raise
        save(STATE, {'state': 'exited', 'exitCode': 127, 'error': str(error)[:500]})
        raise

def status():
    try: value = json.loads(STATE.read_text())
    except FileNotFoundError:
        print('missing')
        return 2
    if value.get('state') == 'running' and isinstance(value.get('pid'), int):
        try: os.kill(value['pid'], 0)
        except ProcessLookupError:
            value = {'state': 'exited', 'exitCode': 127, 'error': 'job supervisor exited without recording a result'}
            save(STATE, value)
    print(json.dumps(value, separators=(',', ':')))
    return 0

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['launch']: launch()
        elif sys.argv[1:] == ['launch', '--foreground']: launch(foreground=True)
        elif len(sys.argv) == 4 and sys.argv[1] == '_run': run(json.loads(sys.argv[2]), sys.argv[3])
        elif sys.argv[1:] == ['status']: raise SystemExit(status())
        else: raise ValueError('usage: factorize-job launch [--foreground]|status')
    except Exception as error:
        print('factorize-job: ' + str(error)[:500], file=sys.stderr)
        raise SystemExit(1)
`;
