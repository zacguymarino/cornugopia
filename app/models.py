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

class SiteSettings(Base):
    __tablename__ = "site_settings"

    # always just one row (id=1)
    id = Column(Integer, primary_key=True, default=1)

    # Snackbar configuration
    snackbar_message = Column(String,   default="",  nullable=False)
    snackbar_active = Column(Boolean,  default=False)
    snackbar_timeout_seconds = Column(Integer,  default=5)

    # Sponsorship banner
    sponsor_active = Column(Boolean,  default=False)
    sponsor_image_desktop = Column(String,   nullable=True)
    sponsor_image_mobile = Column(String,   nullable=True)
    sponsor_target_url = Column(String,   nullable=True)

    # track when last changed
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow
    )