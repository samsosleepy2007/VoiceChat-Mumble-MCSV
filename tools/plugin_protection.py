"""Portable release protection without a remote service or Python-version bytecode."""
import ast
import base64
import hashlib
import random
import zlib


def protect(text, filename):
    # Reuse the cautious scope transformer; never rename framework-facing names.
    from build_obfuscated import Locals
    tree = Locals().visit(ast.parse(text))
    seed = hashlib.sha256((filename + text).encode()).digest()
    rng = random.Random(seed)
    existing = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    name = '_p' + seed.hex()[:20]
    while name in existing:
        name += '_'
    excluded = set()
    for node in ast.walk(tree):
        # Future annotations, docstrings, match patterns and f-string segments
        # have special syntax or reflection semantics; preserve them.
        parts = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            parts.append(node.returns)
        if isinstance(node, ast.arg):
            parts.append(node.annotation)
        if isinstance(node, ast.AnnAssign):
            parts.append(node.annotation)
        if isinstance(node, (ast.JoinedStr, ast.pattern)):
            parts.append(node)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant):
                parts.append(node.body[0])
        for part in parts:
            if part is not None:
                excluded.update(id(n) for n in ast.walk(part))
    literals = []
    indices = {}
    class Strings(ast.NodeTransformer):
        def visit_Constant(self, node):
            if id(node) in excluded or not isinstance(node.value, str):
                return node
            index = indices.setdefault(node.value, len(indices))
            if index == len(literals):
                raw = node.value.encode('utf-8')
                key = rng.randrange(1, 256)
                literals.append((key, bytes(x ^ key for x in raw)))
            return ast.copy_location(ast.Subscript(value=ast.Name(id=name, ctx=ast.Load()), slice=ast.Constant(index), ctx=ast.Load()), node)
    tree = Strings().visit(tree)
    # Decode once at import, not in the voice/update loop.
    initializer = ast.parse(f'{name} = tuple(bytes(x ^ k for x in v).decode("utf-8") for k, v in {literals!r})').body
    insert = 0
    if tree.body and isinstance(tree.body[0], ast.Expr) and isinstance(tree.body[0].value, ast.Constant):
        insert = 1
    while insert < len(tree.body) and isinstance(tree.body[insert], ast.ImportFrom) and tree.body[insert].module == '__future__':
        insert += 1
    tree.body[insert:insert] = initializer
    ast.fix_missing_locations(tree)
    source = ast.unparse(tree).encode()
    compile(source, filename, 'exec', dont_inherit=True)
    compressed = zlib.compress(source, 9)
    key = bytes(rng.randrange(256) for _ in range(32))
    payload = base64.b85encode(bytes(x ^ key[i % len(key)] for i, x in enumerate(compressed)))
    # No marshal, eval of remote input, external runtime, or platform dependency.
    # This remains recoverable obfuscation; the embedded mask is not a secret.
    wrapper = f'''# Copyright SamSoSleepy. Protected distribution; see packaged license.
def {name}_load():
    import base64, zlib, hashlib
    k = {key!r}
    p = base64.b85decode({payload!r})
    s = zlib.decompress(bytes(x ^ k[i % len(k)] for i, x in enumerate(p)))
    if hashlib.sha256(s).hexdigest() != {hashlib.sha256(source).hexdigest()!r}:
        raise ImportError("Protected module integrity check failed")
    exec(compile(s, __file__, "exec", dont_inherit=True), globals())
{name}_load()
del {name}_load
'''
    compile(wrapper, filename, 'exec', dont_inherit=True)
    return wrapper.encode()
