"""Validate a legacy .cramerscan package and merge it into a NEW migration copy.
Catalog (exams/versions/questions) must come from the corresponding SQLite export.
"""
import argparse,hashlib,json,zipfile
from pathlib import Path,PurePosixPath

def convert(package,catalog,output):
    package=Path(package).resolve(strict=True);target=Path(output).resolve()
    if target.exists():raise ValueError('El destino ya existe; usa uno nuevo')
    if package.stat().st_size>500*1024*1024:raise ValueError('Máximo 500 MB')
    source=json.loads(Path(catalog).read_text(encoding='utf8'))
    with zipfile.ZipFile(package) as archive:
        entries=archive.infolist()
        if len(entries)>5000 or sum(e.file_size for e in entries)>500*1024*1024:raise ValueError('Límites de paquete excedidos')
        for e in entries:
            p=PurePosixPath(e.filename)
            if '\\' in e.filename or p.is_absolute() or '..' in p.parts or ':' in e.filename:raise ValueError('Ruta insegura en paquete')
        if len({e.filename for e in entries})!=len(entries):raise ValueError('Entradas duplicadas')
        manifest=json.loads(archive.read('manifest.json'));checks=json.loads(archive.read('checksums.json'))
        scans=manifest.get('scans',[])
        if manifest.get('formatVersion')!=1 or manifest.get('numberOfScans')!=len(scans):raise ValueError('Formato o número de escaneos inválido')
        images=target.parent/'package-images';images.mkdir(parents=True,exist_ok=True)
        # Validate every byte/hash before writing extracted images.
        validated=[]
        for scan in scans:
            name=scan.get('imageEntry','')
            if not name.startswith('images/'):raise ValueError('Imagen fuera de images/')
            data=archive.read(name);digest=hashlib.sha256(data).hexdigest()
            if checks.get(name)!=digest or scan.get('imageHash')!=digest:raise ValueError('Checksum inválido')
            suffix=PurePosixPath(name).suffix.lower()
            if suffix not in ('.jpg','.jpeg','.png','.webp'):raise ValueError('Tipo de imagen no permitido')
            image=images/(digest+suffix);validated.append((scan,image,data))
        student_rows=source['tables'].setdefault('students',[]);student_ids={r['id'] for r in student_rows}
        for s in manifest.get('students',[]):
            if s['id'] not in student_ids:student_rows.append({'id':s['id'],'payload':json.dumps(s,ensure_ascii=False)});student_ids.add(s['id'])
        scan_rows=source['tables'].setdefault('scans',[]);existing={r['id']:json.loads(r['payload']) for r in scan_rows}
        for scan,image,data in validated:
            if scan['id'] in existing:
                if existing[scan['id']]['imageHash']!=scan['imageHash']:raise ValueError('Mismo ID con hash distinto')
                continue
            image.write_bytes(data);scan={**scan,'imagePath':str(image)};scan_rows.append({'id':scan['id'],'payload':json.dumps(scan,ensure_ascii=False)})
    target.write_text(json.dumps(source,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'scansValidated':len(scans),'output':str(target)},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--catalog',required=True);p.add_argument('--output',required=True);a=p.parse_args();convert(a.package,a.catalog,a.output)
