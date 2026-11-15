import io
import os
import unittest
from unittest.mock import patch
from PIL import Image
import httpx
from fastapi.testclient import TestClient
from backend.main import app, _rate
from backend.mission.routes import MISSIONS, resize_image

class API(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)
    def test_catalog_health_and_missing_key(self):
        self.assertEqual(self.client.get('/healthz').json()['backend'], 'python')
        self.assertEqual(len([m for m in self.client.get('/api/missions').json().values() if m.get('panorama')]), 6)
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            self.assertFalse(self.client.get('/api/si/status').json()['configured'])
            self.assertEqual(self.client.post('/api/si/chat', json={'messages': []}).status_code, 503)
        self.assertEqual(self.client.get('/api/missions/olympus/panorama').status_code, 404)
        self.assertEqual(self.client.get('/.env').status_code, 403)
    def test_cross_origin_and_body_limits(self):
        self.assertEqual(self.client.post('/api/si/chat',headers={'Origin':'https://untrusted.example'},json={}).status_code,403)
        self.assertEqual(self.client.post('/api/si/chat',content='x'*48001).status_code,413)
    def test_invalid_conversation(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'server-only-test'}):
            self.assertEqual(self.client.post('/api/si/chat',json={'messages':[{'role':'system','content':'bad'}]}).status_code,400)
            self.assertEqual(self.client.post('/api/si/chat',json={'messages':[{'role':'user','content':'x'*4001}]}).status_code,400)
    def test_gemini_server_owned_payload_and_key(self):
        captured={}
        class Client:
            def __init__(self,**kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
            async def post(self,url,**kwargs):
                captured.update({'url':url,**kwargs})
                return httpx.Response(200,json={'candidates':[{'content':{'parts':[{'thought':True,'text':'hidden'},{'text':'Hello from S.A.M.'}]}}]})
        with patch.dict(os.environ, {'GEMINI_API_KEY':'server-only-test'}),patch('backend.si.httpx.AsyncClient',Client):
            result=self.client.post('/api/si/chat',json={'messages':[{'role':'user','content':'Hello'}],'context':{'layer':'optical'},'system':'untrusted'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['reply'],'Hello from S.A.M.')
        self.assertNotIn('server-only-test',result.text)
        self.assertEqual(captured['headers']['x-goog-api-key'],'server-only-test')
        self.assertIn('You are S.A.M',captured['json']['systemInstruction']['parts'][0]['text'])
        self.assertIn('optical',captured['json']['contents'][0]['parts'][0]['text'])
    def test_gemini_empty_and_quota_responses(self):
        class Client:
            status = 200
            def __init__(self,**kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
            async def post(self,*args,**kwargs):
                return httpx.Response(self.status,json={'candidates': []})
        with patch.dict(os.environ, {'GEMINI_API_KEY':'server-only-test'}),patch('backend.si.httpx.AsyncClient',Client):
            body={'messages':[{'role':'user','content':'Hello'}]}
            self.assertEqual(self.client.post('/api/si/chat',json=body).status_code,502)
            Client.status=429
            self.assertEqual(self.client.post('/api/si/chat',json=body).status_code,429)
    def test_partial_coverage_not_fabricated(self):
        self.assertEqual(MISSIONS['insight']['panorama']['coverage'],290)
        for id in ['jezero','curiosity','spirit','opportunity','pathfinder']:
            self.assertEqual(MISSIONS[id]['panorama']['coverage'],360)
    def test_downsample_preserves_aspect(self):
        b=io.BytesIO();Image.new('RGB',(9000,900)).save(b,'PNG')
        with Image.open(io.BytesIO(resize_image(b.getvalue()))) as image:
            self.assertEqual(image.size,(8192,819))

if __name__=='__main__':unittest.main()
