"""Read original SQLite in read-only mode, backup then export the snapshot only.
No application database is opened for writing. Output is private migration material.
"""
import argparse,hashlib,json,sqlite3
from contextlib import closing
from pathlib import Path

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def export(source,output):
    source=Path(source).resolve(strict=True);output=Path(output).resolve()
    if source==output or source in output.parents: raise ValueError('Destino debe ser una carpeta independiente')
    output.mkdir(parents=True,exist_ok=True)
    snapshot=output/'snapshot.sqlite'
    if snapshot.exists(): raise ValueError('El destino ya contiene snapshot.sqlite. Usa otra carpeta para no sobrescribir copias.')
    before=digest(source)
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original:
        with closing(sqlite3.connect(snapshot)) as copy: original.backup(copy)
    result={'format':'cramer-sqlite-export','version':1,'sourceHash':before,'tables':{}}
    with closing(sqlite3.connect(snapshot.as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row
        tables=[r[0] for r in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
        for table in tables:
            safe=table.replace('"','""')
            result['tables'][table]=[dict(row) for row in db.execute(f'SELECT * FROM "{safe}"')]
    def json_value(v):
        if isinstance(v,bytes):
            assets=output/'sqlite-assets';assets.mkdir(exist_ok=True)
            target=assets/(hashlib.sha256(v).hexdigest()+'.blob');target.write_bytes(v)
            return {'legacyFile':str(target)}
        raise TypeError(type(v).__name__)
    (output/'legacy.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=json_value),encoding='utf8')
    after=digest(source)
    if before!=after: raise RuntimeError('El origen cambió durante la exportación. Cierra Flutter y repite con una copia estable.')
    audit={'originalUnchanged':True,'sourceHash':after,'counts':{t:len(rows) for t,rows in result['tables'].items()}}
    (output/'export-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf8')
    print(json.dumps(audit,indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args();export(args.source,args.output)
