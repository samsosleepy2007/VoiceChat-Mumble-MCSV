"""Conservative distribution obfuscation; never mutate development sources."""
import ast, base64, csv, hashlib, io, json, subprocess, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Locals(ast.NodeTransformer):
    def visit_FunctionDef(self,node):
        # Keep reflective/nested scopes intact. Preserve names of methods and arguments.
        if any(isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.Lambda,ast.ListComp,ast.SetComp,ast.DictComp,ast.GeneratorExp,ast.Global,ast.Nonlocal,ast.Import,ast.ImportFrom,ast.ExceptHandler)) for statement in node.body for n in ast.walk(statement)):
            return node
        if any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in {'locals','globals','eval','exec','vars'} for n in ast.walk(node)):
            return node
        args={a.arg for a in [*node.args.posonlyargs,*node.args.args,*node.args.kwonlyargs]}
        if node.args.vararg:args.add(node.args.vararg.arg)
        if node.args.kwarg:args.add(node.args.kwarg.arg)
        allnames={n.id for n in ast.walk(node) if isinstance(n,ast.Name)}
        names=sorted({n.id for n in ast.walk(node) if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store)}-args)
        mapping={};count=0
        for name in names:
            while '_o'+str(count) in allnames:count+=1
            mapping[name]='_o'+str(count);count+=1
        for statement in node.body:
            for n in ast.walk(statement):
                if isinstance(n,ast.Name) and n.id in mapping:n.id=mapping[n.id]
        return node
    visit_AsyncFunctionDef=visit_FunctionDef

def protect_python(text, filename='<protected>'):
    from plugin_protection import protect
    return protect(text, filename)

def digest(data):return hashlib.sha256(data).hexdigest()
def main():
    out=ROOT/'obfuscator';(out/'addon').mkdir(parents=True,exist_ok=True);(out/'plugin').mkdir(exist_ok=True)
    subprocess.run(['node',str(ROOT/'tools/obfuscation/addon.mjs')],check=True,cwd=ROOT)
    version='.'.join(map(str,json.loads((ROOT/'addon/BP/manifest.json').read_text())['header']['version']))
    addonpath=out/'addon'/f'VC_Mumble_ItemMic_v{version}_protected.mcaddon'
    transformed=(out/'addon/main.protected.js').read_bytes()
    with zipfile.ZipFile(addonpath,'w',zipfile.ZIP_DEFLATED) as outer:
        for pack in ['BP','RP']:
            buf=io.BytesIO()
            with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as inner:
                for path in sorted((ROOT/'addon'/pack).rglob('*')):
                    if not path.is_file():continue
                    name=path.relative_to(ROOT/'addon'/pack).as_posix()
                    # Build from the checked-in asset, excluding unrelated workspace edits.
                    data=transformed if pack=='BP' and name=='scripts/main.js' else subprocess.check_output(['git','show','HEAD:'+path.relative_to(ROOT).as_posix()])
                    inner.writestr(name,data)
            outer.writestr(f'SleepyMumla_{pack}.mcpack',buf.getvalue())
    # The plugin wheel is built separately by tools/build_plugin_wheel.py (native .so compiled with
    # the server's Python 3.12 ABI). Here we only (re)build the addon and refresh SHA256SUMS to list
    # the addon plus the most recent plugin wheel present in obfuscator/plugin.
    wheels=sorted((out/'plugin').glob('endstone_mumble_host-*.whl'))
    entries=[addonpath]+([wheels[-1]] if wheels else [])
    (out/'SHA256SUMS.txt').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(out)}\n' for p in entries))
    print(addonpath)
    [print(w) for w in wheels[-1:]]
if __name__=='__main__':main()
