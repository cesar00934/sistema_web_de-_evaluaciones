import hashlib,importlib.util,json,sqlite3,tempfile,unittest,zipfile
from contextlib import closing
from pathlib import Path

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path('scripts')/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class MigrationToolsTest(unittest.TestCase):
    def test_readonly_backup_and_blob_as_file(self):
        with tempfile.TemporaryDirectory(dir='artifacts') as root:
            root=Path(root);original=root/'original.sqlite'
            with closing(sqlite3.connect(original)) as db:db.execute('create table fixture(id text,payload blob)');db.execute('insert into fixture values(?,?)',('id',b'private-bytes'));db.commit()
            before=hashlib.sha256(original.read_bytes()).hexdigest();module('export_sqlite').export(original,root/'copy')
            self.assertEqual(before,hashlib.sha256(original.read_bytes()).hexdigest());data=json.loads((root/'copy/legacy.json').read_text(encoding='utf8'));self.assertIn('legacyFile',data['tables']['fixture'][0]['payload']);self.assertNotIn('Base64',json.dumps(data))

    def test_hive_conversion_extracts_bytes_and_preserves_original_json(self):
        with tempfile.TemporaryDirectory(dir='artifacts') as root:
            root=Path(root);original=root/'hive.json';original.write_text(json.dumps({'exam_data':{'logoIzquierdoBytes':{'legacyBytes':'YWJjZA=='},'draftQuestions':[{'id':'q','enunciado':'Texto','tipo':'alternativas','opciones':['A','B'],'correcta':0}]}}),encoding='utf8');before=original.read_bytes();module('convert_hive').convert(original,None,root/'new/legacy.json');data=json.loads((root/'new/legacy.json').read_text(encoding='utf8'));self.assertEqual(len(data['tables']['questions']),1);self.assertNotIn('legacyBytes',json.dumps(data));self.assertEqual(original.read_bytes(),before)

    def test_package_integrity_and_unsafe_paths(self):
        with tempfile.TemporaryDirectory(dir='artifacts') as root:
            root=Path(root);catalog=root/'catalog.json';catalog.write_text(json.dumps({'format':'cramer-sqlite-export','version':1,'sourceHash':'test','tables':{}}),encoding='utf8');image=b'synthetic';digest=hashlib.sha256(image).hexdigest();scan={'id':'scan','imageEntry':'images/scan.png','imageHash':digest};manifest={'formatVersion':1,'numberOfScans':1,'scans':[scan],'students':[]};package=root/'safe.cramerscan'
            with zipfile.ZipFile(package,'w') as z:z.writestr('manifest.json',json.dumps(manifest));z.writestr('checksums.json',json.dumps({'images/scan.png':digest}));z.writestr('images/scan.png',image)
            module('convert_package').convert(package,catalog,root/'output/legacy.json');self.assertTrue((root/'output/legacy.json').exists())
            bad=root/'bad.cramerscan'
            with zipfile.ZipFile(bad,'w') as z:z.writestr('../outside.png',image)
            with self.assertRaisesRegex(ValueError,'insegura'):module('convert_package').convert(bad,catalog,root/'unsafe/legacy.json')

if __name__=='__main__':unittest.main()
