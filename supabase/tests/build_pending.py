#!/usr/bin/env python3
"""Junta as migrations 0013..última num único arquivo para colar no SQL Editor
do Supabase. O arquivo é re-executável: antes de cada `create policy` entra um
`drop policy if exists`, então pode ser colado mesmo que parte já tenha sido
aplicada. Uso: python3 supabase/tests/build_pending.py [primeira] (padrão 0013)"""
import glob, os, re, sys

first = sys.argv[1] if len(sys.argv) > 1 else "0013"
root = os.path.join(os.path.dirname(__file__), "..")
files = sorted(f for f in glob.glob(os.path.join(root, "migrations", "*.sql"))
               if os.path.basename(f)[:4] >= first)
policy = re.compile(r'^create policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)', re.M)

out = [f"-- MindManager: migrations {os.path.basename(files[0])[:4]} a {os.path.basename(files[-1])[:4]} num arquivo só.\n"
       "-- Pode ser colado inteiro no SQL Editor do Supabase (é re-executável).\n"]
for f in files:
    sql = open(f, encoding="utf-8").read()
    sql = policy.sub(lambda m: f"drop policy if exists {m.group(1)} on {m.group(2)};\n{m.group(0)}", sql)
    out.append(f"\n-- ===================================================================\n-- {os.path.basename(f)}\n-- ===================================================================\n{sql}")

dest = os.path.join(root, "pending", f"aplicar_{os.path.basename(files[0])[:4]}_a_{os.path.basename(files[-1])[:4]}.sql")
open(dest, "w", encoding="utf-8").write("".join(out))
print(dest)
