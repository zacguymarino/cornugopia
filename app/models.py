# models.py
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime
import datetime

Base = declarative_base()

class PublicGame(Base):
    __tablename__ = "public_games"

    id = Column(String, primary_key=True)  # game_id
    board_size = Column(Integer)
    created_by = Column(String)
    rule_set = Column(String)
    komi = Column(Float)
    time_control = Column(String)
    byo_yomi_periods = Column(Integer)
    byo_yomi_time = Column(Integer)  # in seconds
    color_preference = Column(String)
    allow_handicaps = Column(Boolean)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
