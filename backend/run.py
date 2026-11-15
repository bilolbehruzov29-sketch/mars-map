import os
import uvicorn
from backend.config import settings  # noqa: F401  (loads .env before the app starts)

if __name__ == '__main__':
    uvicorn.run('backend.main:app', host=os.getenv('HOST', '0.0.0.0'), port=int(os.getenv('PORT', '8000')),
                proxy_headers=True,
                # Behind a hosting proxy (Render, nginx) set FORWARDED_ALLOW_IPS='*' so rate limits see real client IPs.
                forwarded_allow_ips=os.getenv('FORWARDED_ALLOW_IPS', '127.0.0.1'))
