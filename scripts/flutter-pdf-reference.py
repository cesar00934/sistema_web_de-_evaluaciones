"""Run the unchanged Flutter PDF layout in the local Dart PDF engine for comparison.

Requires the existing Flutter SDK/pub cache. Uses synthetic fixtures only; writes artifacts.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import shutil

root = Path.cwd()
out = root / "artifacts/flutter-reference"
out.mkdir(parents=True, exist_ok=True)
source = (root.parent / "lib/features/exam_editor/exam_editor_page.dart").read_text(encoding="utf-8")
for font in ["Roboto-Regular.ttf", "CAMBRIAB.TTF", "CAMBRIAI.TTF"]:
    assert (root / "public/fonts" / font).read_bytes() == (root.parent / "assets/fonts" / font).read_bytes(), font
frame = source[source.index("  pw.Widget buildMarco("):source.index("  Future<Uint8List> _generarPDFBytes(")]
start = source.index("    pw.Widget buildSubtitulo(")
layout = source[start:source.index("    if (!withAnswers && applyGenerationMode", start)]
fixture = json.loads((root / "artifacts/pdf/layout-fixture.json").read_text(encoding="utf-8"))
exam = fixture["exam"]
settings = exam["settings"]
values = {"nivel": exam["level"], "grado": exam["grade"], "materia": exam["area"], "subarea": settings.get("subarea", ""), "bimestre": exam["bimester"], "unidad": exam["unit"], "profesor": settings.get("teacherName", ""), "fecha": "05-11-2026", "indicaciones": settings.get("instructions", ""), "correo": "contacto@cramer.com.pe", "telefono": "961 055 829", "facebook": "Colegio Cramer | Huacho"}
controllers = "\n".join(f"final _{name}Controller = (text: {json.dumps(value, ensure_ascii=False)},);" for name, value in values.items())
dart = r'''
import 'dart:io';
import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
enum TipoPregunta {alternativas,relacionar,responder,verdaderoFalso}
class AppLogger {static final instance=AppLogger();Future<void> error(String s,Object e)async{stderr.writeln(e);}}
class Pregunta {
  final Map<String,dynamic> q;
  Pregunta(this.q);
  String get enunciado=>q['prompt'];String? get subtitulo=>q['subtitle'];
  TipoPregunta get tipo=>{'multipleChoice':TipoPregunta.alternativas,'matching':TipoPregunta.relacionar,'trueFalse':TipoPregunta.verdaderoFalso,'openResponse':TipoPregunta.responder}[q['type']]!;
  File? get imagen=>q['imagePath']==null?null:File('public/icon-192.png');
  List<String> get opciones=>List<String>.from(q['options']);
  int get correcta=>q['correctOptionIndex']??0;
  List<String>? get columnasIzquierda=>List<String>.from(q['leftColumn']);
  List<String>? get columnasDerecha=>List<String>.from(q['rightColumn']);
  List<int>? get relacionesCorrectas=>List<int>.from(q['matchingAnswers']);
  List<String>? get verdaderoFalsoPreguntas=>List<String>.from(q['trueFalseStatements']);
  List<bool?>? get respuestasVF=>List<bool?>.from(q['trueFalseAnswers']);
  String? get respuestaCorrecta=>q['referenceAnswer'];
}
'''
dart += frame
dart += "\nFuture<void> main() async {\n"
dart += controllers
dart += r'''
  final fixture=jsonDecode(await File('artifacts/pdf/layout-fixture.json').readAsString());
  final preguntas=(fixture['version']['questions'] as List).map((q)=>Pregunta(Map<String,dynamic>.from(q))).toList();
  final robotoRegular=pw.Font.ttf(ByteData.sublistView(await File('public/fonts/Roboto-Regular.ttf').readAsBytes()));
  final cambria=pw.Font.ttf(ByteData.sublistView(await File('public/fonts/CAMBRIAB.TTF').readAsBytes()));
  final gabriola=pw.Font.ttf(ByteData.sublistView(await File('public/fonts/CAMBRIAI.TTF').readAsBytes()));
  final pdf=pw.Document(theme:pw.ThemeData.withFont(base:robotoRegular,bold:robotoRegular));
  final marcaAgua=pw.MemoryImage(await File('public/institutional/fc.png').readAsBytes());
  pw.ImageProvider? marcaAguaFooterImage,encabezadoImage,encabezadoImage2,logoIzqImage,logoDerImage;
  const withAnswers=false,_marcoSeleccionado='Curvo';
'''
dart += layout
dart += "await File('artifacts/pdf/flutter-reference.pdf').writeAsBytes(await pdf.save());\n}\n"
(out / "reference.dart").write_text(dart, encoding="utf-8")
cache = Path(os.environ.get("LOCALAPPDATA", "")) / "Pub/Cache/hosted/pub.dev"
if not cache.is_dir():
    cache = Path("C:/Users/Alumno/AppData/Local/Pub/Cache/hosted/pub.dev")
packages = {}
for p in sorted(cache.iterdir()):
    match = re.match(r"(.+)-\d", p.name)
    if match and p.is_dir():
        packages[match[1]] = {"name": match[1], "rootUri": p.as_uri(), "packageUri": "lib/"}
packages['pdf']={"name":"pdf","rootUri":(cache/'pdf-3.11.3').as_uri(),"packageUri":"lib/"}
(out / "package_config.json").write_text(json.dumps({"configVersion":2,"packages":list(packages.values())}), encoding="utf-8")
command = shutil.which("dart")
if not command:
    raise RuntimeError("Dart SDK is required for the original-engine reference")
sdk = Path(command).parent / "cache/dart-sdk/bin/dart.exe"
subprocess.run([str(sdk if sdk.exists() else command), f"--packages={out / 'package_config.json'}", str(out / "reference.dart")],check=True,cwd=root)
print("Original Flutter PDF body executed with original fonts and synthetic questions.")

import pdfplumber

documents = []
for name in ["flutter-reference", "layout-web"]:
    with pdfplumber.open(root / f"artifacts/pdf/{name}.pdf") as document:
        page = document.pages[0]
        anchors = [(c["text"], c["x0"], c["top"], c["size"]) for c in page.chars
                   if c["text"] in "12345" and abs(c["size"]-12)<0.01
                   and (abs(c["x0"]-41)<0.01 or abs(c["x0"]-310.638)<0.01)]
        frames = [(c["x0"], c["top"], c["x1"], c["bottom"]) for c in page.curves if abs(c["x0"]-25)<0.01]
        documents.append({"anchors":anchors,"frames":frames})
delta = 0.0
for kind in ["anchors", "frames"]:
    original, web = documents[0][kind], documents[1][kind]
    assert len(original)==len(web), (kind,original,web)
    for a,b in zip(original,web):
        if kind=="anchors":
            assert a[0]==b[0]
            a,b=a[1:],b[1:]
        delta=max(delta,*(abs(x-y) for x,y in zip(a,b)))
assert delta<0.02, delta
(out / "comparison.json").write_text(json.dumps({"scope":"Five mixed questions in two subtitle blocks; original Dart PDF engine versus web renderer", "maximum_difference_pt":delta, "question_positions_and_sizes":documents, "tolerance_pt":0.02},indent=2),encoding="utf-8")
print(f"Question positions, font sizes and frames match the original within {delta:.4f} pt.")
