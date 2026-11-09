"""Merge exported Hive preferences/draft into a NEW SQLite export JSON.
Unknown preferences stay in a private archive; binary logos become files, never DB Base64.
"""
import argparse,base64,hashlib,json,uuid
from pathlib import Path
from datetime import datetime,timezone

def convert(hive_path,sqlite_path,output):
    hive=json.loads(Path(hive_path).read_text(encoding='utf8'));source=json.loads(Path(sqlite_path).read_text(encoding='utf8')) if sqlite_path else {'format':'cramer-sqlite-export','version':1,'sourceHash':hashlib.sha256(Path(hive_path).read_bytes()).hexdigest(),'tables':{}}
    target=Path(output).resolve()
    if target.exists():raise ValueError('Usa un destino nuevo, no sobrescribas exportaciones')
    target.parent.mkdir(parents=True,exist_ok=True);assets=target.parent/'hive-assets';assets.mkdir(exist_ok=True)
    def strip(v,key='blob'):
        if isinstance(v,dict) and 'legacyBytes' in v:
            data=base64.b64decode(v['legacyBytes'],validate=True);name=hashlib.sha256(data).hexdigest()+'.bin';(assets/name).write_bytes(data);return {'legacyFile':str(assets/name)}
        if isinstance(v,list):return [strip(x,key) for x in v]
        if isinstance(v,dict):return {k:strip(x,k) for k,x in v.items()}
        return v
    clean=strip(hive);source['tables'].setdefault('hive',[]).append({'id':'preferences','payload':json.dumps(clean,ensure_ascii=False)})
    data=hive.get('exam_data',{});existing={r['id'] for r in source['tables'].get('questions',[]) if 'id' in r};draft=[];now=datetime.now(timezone.utc).isoformat()
    mode=data.get('scoringMode','manual');total=float(data.get('customScoringTotal',40));stored=data.get('draftQuestions',[])
    for index,p in enumerate(stored):
        qid=p.get('id') or str(uuid.uuid5(uuid.NAMESPACE_URL,source['sourceHash']+':draft:'+str(index)));draft.append(qid)
        if qid in existing:continue
        q={'id':qid,'type':{'alternativas':'multipleChoice','verdaderoFalso':'trueFalse','relacionar':'matching','responder':'openResponse'}.get(p.get('tipo'),'multipleChoice'),'prompt':p.get('enunciado',''),'subtitle':p.get('subtitulo') or '', 'options':p.get('opciones',[]),'correctOptionIndex':p.get('correcta',0),'trueFalseStatements':p.get('verdaderoFalsoPreguntas') or [],'trueFalseAnswers':p.get('respuestasVF') or [],'leftColumn':p.get('columnasIzquierda') or [],'rightColumn':p.get('columnasDerecha') or [],'matchingAnswers':p.get('relacionesCorrectas') or [],'referenceAnswer':p.get('respuestaCorrecta') or '', 'score':20/len(stored) if mode in ('automatic20','none') else total/len(stored) if mode=='customTotal' else p.get('puntaje',1),'area':p.get('area') or data.get('materia',''),'subarea':p.get('subarea',''),'topic':p.get('tema',''),'competency':p.get('competencia',''),'difficulty':{'FÁCIL':'easy','FACIL':'easy','DIFÍCIL':'hard','DIFICIL':'hard'}.get(p.get('dificultad','').upper(),'medium'),'imagePath':p.get('imagenPath'),'createdAt':p.get('fechaCreacion',now),'updatedAt':p.get('fechaModificacion',now)}
        if q['type']!='multipleChoice':q['correctOptionIndex']=None
        source['tables'].setdefault('questions',[]).append({'id':qid,'payload':json.dumps(q,ensure_ascii=False)})
    exam_id=data.get('draftExamId') or str(uuid.uuid5(uuid.NAMESPACE_URL,source['sourceHash']+':draft'))
    if draft and not any(r.get('id')==exam_id for r in source['tables'].get('exams',[])):
        e={'id':exam_id,'title':data.get('materia') or 'Borrador recuperado de Hive','area':data.get('materia',''),'level':data.get('nivel',''),'grade':data.get('grado',''),'section':data.get('seccion',''),'bimester':data.get('bimestre',''),'unit':data.get('unidad',''),'teacherId':data.get('profesor') or None,'questionIds':draft,'scaleMaximum':20,'createdAt':now,'updatedAt':now,'isDraft':True,'legacySettings':{'scoringMode':mode,'total':total,'instructions':data.get('indicaciones','')}}
        source['tables'].setdefault('exams',[]).append({'id':exam_id,'payload':json.dumps(e,ensure_ascii=False)})
    target.write_text(json.dumps(source,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'output':str(target),'draftQuestions':len(draft),'binaryAssets':len(list(assets.iterdir()))},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--hive-json',required=True);p.add_argument('--sqlite-json');p.add_argument('--output',required=True);a=p.parse_args();convert(a.hive_json,a.sqlite_json,a.output)
