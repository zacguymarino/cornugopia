# app/init_db.py

from db import engine
from models import Base
import asyncio

async def reset_db():
    async with engine.begin() as conn:
        # DROP every table defined on Base
        await conn.run_sync(Base.metadata.drop_all)
        # CREATE them fresh
        await conn.run_sync(Base.metadata.create_all)
    print("Schemas reset successfully.")

if __name__ == "__main__":
    asyncio.run(reset_db())
