#!/usr/bin/env python3
"""Run one local verification command and preserve exact output and result metadata."""
import json, os, subprocess, sys, time
from pathlib import Path
name, *command = sys.argv[1:]
if not name or '/' in name or not command:
    raise SystemExit('usage: run-check.py evidence-name command [args]')
start = time.monotonic()
result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
base = Path('docs/evidence') / name
base.with_suffix('.log').write_text(result.stdout)
base.with_suffix('.json').write_text(json.dumps({
    'command': command, 'exit_code': result.returncode,
    'seconds': time.monotonic() - start,
    'profile': os.environ.get('FOUNDRY_PROFILE', 'default'),
    'invariant_runs_override': os.environ.get('FOUNDRY_INVARIANT_RUNS'),
    'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
}, indent=2) + '\n')
print(result.stdout[-6000:])
raise SystemExit(result.returncode)
