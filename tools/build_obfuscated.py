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
# Fixed metadata keeps rebuilds byte-identical so the website can pin hashes.
ZIP_TIME=(2020,1,1,0,0,0)
def zipwrite(archive,name,data):
    info=zipfile.ZipInfo(name,date_time=ZIP_TIME);info.compress_type=zipfile.ZIP_DEFLATED
    info.external_attr=(0o100755 if name.endswith('bin/mumble-server-vc') else 0o100644)<<16
    archive.writestr(info,data)
def main():
    import tomllib
    out=ROOT/'obfuscator';(out/'addon').mkdir(parents=True,exist_ok=True);(out/'plugin').mkdir(exist_ok=True)
    subprocess.run(['node',str(ROOT/'tools/obfuscation/addon.mjs')],check=True,cwd=ROOT)
    manifest=json.loads((ROOT/'addon/BP/manifest.json').read_text())
    version='.'.join(map(str,manifest['header']['version']))
    plugin_version=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version']
    addonpath=out/'addon'/f'VC_Mumble_ItemMic_v{version}_protected.mcaddon'
    transformed=(out/'addon/main.protected.js').read_bytes()
    packs={}
    with zipfile.ZipFile(addonpath,'w') as outer:
        for pack in ['BP','RP']:
            buf=io.BytesIO()
            with zipfile.ZipFile(buf,'w') as inner:
                for path in sorted((ROOT/'addon'/pack).rglob('*')):
                    if not path.is_file():continue
                    name=path.relative_to(ROOT/'addon'/pack).as_posix()
                    zipwrite(inner,name,transformed if pack=='BP' and name=='scripts/main.js' else path.read_bytes())
                    if name=='manifest.json':packs[pack]=json.loads(path.read_text())['header']['uuid']
            zipwrite(outer,f'SleepyMumla_{pack}.mcpack',buf.getvalue())
    # Retain portable Python wheel and entry points; rebuild RECORD after transformations.
    wheel=out/'plugin'/f'endstone_mumble_host-{plugin_version}-py3-none-any.whl'
    dist=f'endstone_mumble_host-{plugin_version}.dist-info';files={}
    for path in sorted((ROOT/'src/endstone_mumble_host').rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            name=path.relative_to(ROOT/'src').as_posix();data=path.read_bytes();files[name]=protect_python(data.decode(), name) if path.suffix=='.py' else data
    files[dist+'/METADATA']=f'Metadata-Version: 2.1\nName: endstone-mumble-host\nVersion: {plugin_version}\nRequires-Python: >=3.11\nRequires-Dist: endstone>=0.11.0\n'.encode()
    files[dist+'/WHEEL']=b'Wheel-Version: 1.0\nGenerator: sleepy-protected\nRoot-Is-Purelib: true\nTag: py3-none-any\n'
    files[dist+'/entry_points.txt']=b'[endstone]\nmumble_host = endstone_mumble_host:MumbleHost\n'
    # Preserve project/upstream licensing in the distribution.
    for path in sorted(ROOT.glob('LICENSE*')):files[dist+'/licenses/'+path.name]=path.read_bytes()
    record=io.StringIO();writer=csv.writer(record,lineterminator='\n')
    for name,data in files.items():writer.writerow([name,'sha256='+base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('='),len(data)])
    writer.writerow([dist+'/RECORD','','']);files[dist+'/RECORD']=record.getvalue().encode()
    with zipfile.ZipFile(wheel,'w') as archive:
        for name,data in files.items():zipwrite(archive,name,data)
    for stale in [*(out/'plugin').glob('*.whl'),*(out/'addon').glob('*.mcaddon')]:
        if stale not in (wheel,addonpath):stale.unlink()
    (out/'SHA256SUMS.txt').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(out)}\n' for p in [addonpath,wheel]))
    release={'plugin':{'file':wheel.name,'version':plugin_version,'sha256':digest(wheel.read_bytes())},
             'addon':{'file':addonpath.name,'version':version,'sha256':digest(addonpath.read_bytes())},
             'packs':{'behavior':packs['BP'],'resource':packs['RP']}}
    (ROOT/'web/join/lib/release.json').write_text(json.dumps(release,indent=2)+'\n')
    print(addonpath);print(wheel)
if __name__=='__main__':main()
