// Run with the ORIGINAL Dart SDK/package configuration, on a COPY of the Hive directory.
// dart run web-next/scripts/export_hive.dart <copied-directory> <output-json>
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:hive/hive.dart';

Future<void> main(List<String> args) async {
  if(args.length!=2) throw ArgumentError('Uso: export_hive.dart <carpeta-copia> <salida.json>');
  final dir=Directory(args[0]).absolute;
  if(!File('${dir.path}/MIGRATION_COPY_ONLY').existsSync()) throw StateError('Copia la carpeta y crea MIGRATION_COPY_ONLY dentro. Nunca abrir los originales.');
  Hive.init(dir.path);
  final output=<String,Object?>{};
  Object? safe(Object? value){if(value is Uint8List)return {'legacyBytes':base64Encode(value)};if(value is List)return value.map(safe).toList();if(value is Map)return value.map((k,v)=>MapEntry(k.toString(),safe(v)));if(value is DateTime)return value.toIso8601String();return value;}
  for(final entity in dir.listSync().whereType<File>().where((f)=>f.path.endsWith('.hive'))){
    final name=entity.uri.pathSegments.last.replaceFirst(RegExp(r'\.hive$'),'');
    final box=await Hive.openBox<dynamic>(name);output[name]={for(final key in box.keys)key.toString():safe(box.get(key))};await box.close();
  }
  await File(args[1]).writeAsString(const JsonEncoder.withIndent('  ').convert(output));
  await Hive.close();
}
