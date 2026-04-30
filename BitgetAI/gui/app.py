# ============================================================
#  BitgetAI Pro - 메인 GUI 애플리케이션
#  CustomTkinter 기반 다크테마 전문 트레이딩 UI
# ============================================================

import customtkinter as ctk
import tkinter as tk
import threading
import queue
import time
import os
import sys
import math
import hashlib as _hashlib
import json as _json_auth
from datetime import datetime
from typing import Optional

# matplotlib 임베딩
import matplotlib
matplotlib.use('TkAgg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
import matplotlib.dates as mdates
plt.style.use('dark_background')

# 프로젝트 모듈
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from src.license  import validate_license, save_license, get_license_info
from src.config   import Config
from src.logger   import Logger
from src.exchange import BitgetAPI
from src.ai_engine import AIEngine
from src.trader   import Trader

# ── 색상 팔레트 ────────────────────────────────────────────────────────
C = {
    'bg':       '#0D1117',
    'panel':    '#161B22',
    'card':     '#1C2128',
    'border':   '#30363D',
    'accent':   '#388BFD',
    'green':    '#3FB950',
    'red':      '#F85149',
    'yellow':   '#D29922',
    'text':     '#E6EDF3',
    'text2':    '#8B949E',
    'hover':    '#21262D',
    'sidebar':  '#010409',
    'bot_on':   '#3FB950',
    'bot_off':  '#F85149',
}

FONT_TITLE  = ('Segoe UI', 22, 'bold')
FONT_LARGE  = ('Segoe UI', 16, 'bold')
FONT_MED    = ('Segoe UI', 13, 'bold')
FONT_NORM   = ('Segoe UI', 12)
FONT_SMALL  = ('Segoe UI', 11)
FONT_MONO   = ('Consolas', 11)

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

# Windows DPI 스케일 보정 (해상도에 따라 UI 크기 자동 조정)
import tkinter as _tk
try:
    _root_check = _tk.Tk()
    _dpi = _root_check.winfo_fpixels('1i')
    _root_check.destroy()
    if _dpi > 96:
        _scale = _dpi / 96.0
        ctk.set_widget_scaling(_scale)
        ctk.set_window_scaling(_scale)
except Exception:
    pass


# ── 로컬 사용자 관리 ──────────────────────────────────────────────────
_USERS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'users.json')

def _hash_pw(pw: str) -> str:
    return _hashlib.sha256(pw.encode()).hexdigest()

def _load_users() -> list:
    if not os.path.exists(_USERS_FILE):
        return []
    try:
        with open(_USERS_FILE, 'r', encoding='utf-8') as f:
            return _json_auth.load(f)
    except Exception:
        return []

def _save_users(users: list):
    try:
        with open(_USERS_FILE, 'w', encoding='utf-8') as f:
            _json_auth.dump(users, f)
    except Exception:
        pass

def _find_user(uid: str):
    for u in _load_users():
        if u['id'].lower() == uid.lower():
            return u
    return None

def _verify_user(uid: str, pw: str):
    u = _find_user(uid)
    if u and u['pw_hash'] == _hash_pw(pw):
        return u
    return None

def _create_user(uid: str, pw: str, license_key: str):
    users = _load_users()
    users.append({'id': uid, 'pw_hash': _hash_pw(pw), 'license_key': license_key})
    _save_users(users)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  로그인 다이얼로그 (사진 스타일)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_DLG_BG    = '#12141C'   # 다이얼로그 배경
_FIELD_BG  = '#1B1E29'   # 입력칸 배경
_BLUE      = '#4F7EF7'   # 포인트 블루
_BLUE_HOV  = '#3A65D4'   # 호버 블루

class LoginDialog(ctk.CTkToplevel):
    """사진과 동일한 스타일의 로그인 창"""

    def __init__(self, parent):
        super().__init__(parent)
        self.result   = None
        self._anim_id = None
        self._phase   = 0.0

        self.title("BitgetAI Pro")
        self.geometry("400x510")
        self.resizable(False, False)
        self.configure(fg_color=_DLG_BG)
        self.grab_set()
        self.focus_set()

        # 화면 중앙
        self.update_idletasks()
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        self.geometry(f"+{(sw-400)//2}+{(sh-510)//2}")

        self._build()
        self._animate()

    # ── 웨이브 로고 ────────────────────────────────────────────────────
    def _build_wave(self):
        self._wave = tk.Canvas(self, width=96, height=56,
                               bg=_DLG_BG, highlightthickness=0)
        self._wave.pack(pady=(32, 0))

    def _draw_wave(self):
        c = self._wave
        c.delete('all')
        bars, bw, gap = 7, 9, 5
        total = bars * bw + (bars - 1) * gap
        sx = (96 - total) / 2

        for i in range(bars):
            p = (i / (bars - 1)) * math.pi * 2 + self._phase
            h = max(8, int(10 + 32 * abs(math.sin(p))))
            x1 = sx + i * (bw + gap)
            x2 = x1 + bw
            y1 = (56 - h) / 2
            y2 = y1 + h
            # 밝기 변화
            bright = abs(math.sin(p))
            r = int(40  + 60  * bright)
            g = int(90  + 100 * bright)
            b = int(200 + 55  * bright)
            c.create_rectangle(x1, y1, x2, y2,
                                fill=f'#{min(r,255):02x}{min(g,255):02x}{min(b,255):02x}',
                                outline='', width=0)

    def _animate(self):
        self._phase += 0.13
        self._draw_wave()
        self._anim_id = self.after(48, self._animate)

    def destroy(self):
        if self._anim_id:
            try:
                self.after_cancel(self._anim_id)
            except Exception:
                pass
        super().destroy()

    # ── UI 빌드 ────────────────────────────────────────────────────────
    def _build(self):
        self._build_wave()

        # 앱 이름
        ctk.CTkLabel(self, text="BitgetAI Pro",
                     font=('Segoe UI', 18, 'bold'),
                     text_color='#E6EDF3').pack(pady=(10, 2))
        ctk.CTkLabel(self, text="AI 자동매매 시스템",
                     font=('Segoe UI', 11),
                     text_color='#5B6378').pack(pady=(0, 18))

        # 입력 필드
        self._id_var   = tk.StringVar()
        self._pw_var   = tk.StringVar()
        self._card_var = tk.StringVar()

        self._make_field('로그인',                        '👤', self._id_var,   False)
        self._make_field('비밀번호',                      '🔒', self._pw_var,   True)
        self._make_field('카드  (카드 코드 입력, 등록 불필요)', '🎫', self._card_var, False)

        # 오류 메시지
        self._err = ctk.CTkLabel(self, text='',
                                  font=('Segoe UI', 11),
                                  text_color='#F85149')
        self._err.pack(pady=(6, 2))

        # 로그인 버튼
        ctk.CTkButton(self,
                      text='로그인  →',
                      font=('Segoe UI', 14, 'bold'),
                      height=46, corner_radius=12,
                      fg_color=_BLUE, hover_color=_BLUE_HOV,
                      command=self._login
                      ).pack(fill='x', padx=30, pady=(2, 10))

        # 하단 링크
        foot = ctk.CTkFrame(self, fg_color='transparent')
        foot.pack()
        ctk.CTkLabel(foot, text='계정이 없으신가요?  ',
                     font=('Segoe UI', 11),
                     text_color='#5B6378').pack(side='left')
        ctk.CTkButton(foot, text='가입하기',
                      font=('Segoe UI', 11, 'bold'),
                      text_color=_BLUE, fg_color=_DLG_BG,
                      hover_color='#1E2130', width=60, height=24,
                      command=self._hint_register).pack(side='left')
        ctk.CTkLabel(foot, text='  비밀번호를 잊으셨나요?',
                     font=('Segoe UI', 11),
                     text_color='#5B6378').pack(side='left')

        # HWID 확인 버튼
        ctk.CTkButton(self,
                      text='🖥  내 HWID 확인 (판매자에게 전달)',
                      font=('Segoe UI', 10),
                      height=28, corner_radius=8,
                      fg_color='#1B1E29', hover_color='#252837',
                      text_color='#5B6378',
                      command=self._show_hwid
                      ).pack(fill='x', padx=30, pady=(10, 0))

    def _make_field(self, placeholder: str, icon: str,
                    var: tk.StringVar, secret: bool):
        frame = ctk.CTkFrame(self, fg_color=_FIELD_BG, corner_radius=12, height=50)
        frame.pack(fill='x', padx=30, pady=5)
        frame.pack_propagate(False)

        ctk.CTkLabel(frame, text=icon,
                     font=('Segoe UI', 16),
                     text_color=_BLUE,
                     fg_color='transparent').pack(side='left', padx=(16, 6))

        ent = ctk.CTkEntry(frame,
                           placeholder_text=placeholder,
                           textvariable=var,
                           show='•' if secret else '',
                           font=('Segoe UI', 12),
                           text_color='#D0D6E8',
                           placeholder_text_color='#4A5068',
                           fg_color='transparent',
                           border_width=0)
        ent.pack(side='left', fill='both', expand=True, padx=(0, 12))

    # ── 로그인 처리 ────────────────────────────────────────────────────
    def _login(self):
        uid  = self._id_var.get().strip()
        pw   = self._pw_var.get().strip()
        card = self._card_var.get().strip()

        if not uid or not pw:
            self._err.configure(text='아이디와 비밀번호를 입력해주세요')
            return

        existing = _find_user(uid)

        if existing:
            # 기존 계정 → 비밀번호 확인
            user = _verify_user(uid, pw)
            if not user:
                self._err.configure(text='비밀번호가 올바르지 않습니다')
                return
            info = validate_license(user['license_key'])
            if not info['valid']:
                self._err.configure(text=info.get('error', '라이센스 만료'))
                return
            self.result = info
            self.destroy()
        else:
            # 신규 계정 → 카드 코드 필수
            if not card:
                self._err.configure(text='신규 등록 시 카드 코드를 입력해주세요')
                return
            info = validate_license(card)
            if not info['valid']:
                self._err.configure(text=info.get('error', '잘못된 카드 코드'))
                return
            _create_user(uid, pw, card)
            save_license(card)
            self.result = info
            self.destroy()

    def _hint_register(self):
        self._err.configure(
            text='ID·비밀번호·카드코드 입력 시 자동 가입됩니다',
            text_color='#3FB950'
        )

    def _show_hwid(self):
        """HWID 팝업 표시 + 클립보드 복사"""
        from src.license import get_hardware_id
        hwid = get_hardware_id()

        win = ctk.CTkToplevel(self)
        win.title("내 HWID")
        win.geometry("480x200")
        win.resizable(False, False)
        win.configure(fg_color=_DLG_BG)
        win.grab_set()
        win.focus_set()
        win.update_idletasks()
        sw = win.winfo_screenwidth()
        sh = win.winfo_screenheight()
        win.geometry(f"+{(sw-480)//2}+{(sh-200)//2}")

        ctk.CTkLabel(win, text='이 HWID를 판매자에게 전달하세요',
                     font=('Segoe UI', 12, 'bold'),
                     text_color='#E6EDF3').pack(pady=(20, 8))

        box = ctk.CTkFrame(win, fg_color='#1B1E29', corner_radius=8)
        box.pack(fill='x', padx=24, pady=4)
        ctk.CTkLabel(box, text=hwid,
                     font=('Consolas', 10),
                     text_color='#D29922',
                     wraplength=400).pack(padx=12, pady=10)

        def _copy():
            try:
                import ctypes
                CF_UNICODETEXT = 13
                GMEM_MOVEABLE  = 0x0002
                k32  = ctypes.windll.kernel32
                u32  = ctypes.windll.user32
                data = hwid.encode('utf-16-le') + b'\x00\x00'
                u32.OpenClipboard(0)
                u32.EmptyClipboard()
                h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
                p = k32.GlobalLock(h)
                ctypes.memmove(p, data, len(data))
                k32.GlobalUnlock(h)
                u32.SetClipboardData(CF_UNICODETEXT, h)
                u32.CloseClipboard()
            except Exception:
                win.clipboard_clear()
                win.clipboard_append(hwid)
                win.update()
            copy_btn.configure(text='✓ 복사됨!')

        copy_btn = ctk.CTkButton(win, text='📋  클립보드에 복사',
                                  font=('Segoe UI', 12),
                                  height=36, corner_radius=8,
                                  fg_color=_BLUE, hover_color=_BLUE_HOV,
                                  command=_copy)
        copy_btn.pack(pady=12)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  메인 애플리케이션
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class BitgetAIApp(ctk.CTk):
    def __init__(self, license_info: dict):
        super().__init__()
        self.license_info = license_info

        # 핵심 컴포넌트
        self.config   = Config()
        self.logger   = Logger()
        self.exchange = BitgetAPI(
            self.config.get('api_key', ''),
            self.config.get('api_secret', ''),
            self.config.get('api_passphrase', ''),
        )
        self.ai     = AIEngine()
        self.trader: Optional[Trader] = None

        # 상태
        self._update_queue: queue.Queue = queue.Queue()
        self._balance = {'total': 0.0, 'free': 0.0}
        self._positions = []
        self._signals   = []
        self._nav_current = 'dashboard'
        self._content_frame = None

        self._setup_window()
        self._build_ui()
        self._start_background_tasks()

        # 로거 콜백 등록
        self.logger.add_callback(self._on_log)

        # 저장된 AI 모델 로드 시도
        if self.ai.load_model():
            self.logger.ai("저장된 AI 모델 로드 완료")

        # 주기적 UI 업데이트
        self._update_timer()

    def _setup_window(self):
        self.title("⚡ BitgetAI Pro - AI 자동매매 시스템")
        self.geometry("1280x820")
        self.minsize(1100, 700)
        self.configure(fg_color=C['bg'])

        # 창 중앙 배치
        self.update_idletasks()
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        x = (sw - 1280) // 2
        y = (sh - 820) // 2
        self.geometry(f"1280x820+{x}+{y}")

    # ── UI 빌드 ─────────────────────────────────────────────────────
    def _build_ui(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # 헤더
        self._build_header()
        # 사이드바
        self._build_sidebar()
        # 메인 콘텐츠
        self._main_frame = ctk.CTkFrame(self, fg_color=C['bg'], corner_radius=0)
        self._main_frame.grid(row=1, column=1, sticky='nsew', padx=(0, 0), pady=0)
        self._main_frame.grid_rowconfigure(0, weight=1)
        self._main_frame.grid_columnconfigure(0, weight=1)
        # 로그 패널
        self._build_log_panel()
        # 첫 화면
        self._show_dashboard()

    def _build_header(self):
        hdr = ctk.CTkFrame(self, height=56, fg_color=C['sidebar'],
                           corner_radius=0, border_width=0)
        hdr.grid(row=0, column=0, columnspan=2, sticky='ew')
        hdr.grid_propagate(False)
        hdr.grid_columnconfigure(1, weight=1)

        # 로고
        ctk.CTkLabel(hdr, text="  ⚡ BitgetAI Pro",
                     font=('Segoe UI', 17, 'bold'),
                     text_color=C['accent']).grid(row=0, column=0, padx=(16, 0), sticky='w')

        # 우측 정보
        info_frame = ctk.CTkFrame(hdr, fg_color='transparent')
        info_frame.grid(row=0, column=2, padx=16, sticky='e')

        self._balance_label = ctk.CTkLabel(info_frame, text="USDT: -",
                                            font=FONT_MED, text_color=C['text'])
        self._balance_label.pack(side='left', padx=12)

        self._status_dot = ctk.CTkLabel(info_frame, text="● 정지",
                                         font=FONT_SMALL, text_color=C['red'])
        self._status_dot.pack(side='left', padx=8)

        tier_color = C['accent'] if self.license_info.get('tier') == 'UNLIMITED' else C['yellow']
        tier_text  = "무제한권" if self.license_info.get('tier') == 'UNLIMITED' else "달권"
        ctk.CTkLabel(info_frame, text=f"[{tier_text}]",
                     font=FONT_SMALL, text_color=tier_color).pack(side='left', padx=4)

    def _build_sidebar(self):
        sb = ctk.CTkFrame(self, width=200, fg_color=C['sidebar'], corner_radius=0)
        sb.grid(row=1, column=0, sticky='nsew')
        sb.grid_propagate(False)

        nav_items = [
            ('dashboard', '  대시보드',   '📊'),
            ('markets',   '  시장분석',   '📈'),
            ('signals',   '  AI 신호',   '🤖'),
            ('positions', '  포지션',     '💼'),
            ('settings',  '  설정',       '⚙️'),
            ('license',   '  라이센스',   '🔑'),
        ]

        self._nav_buttons = {}
        for i, (key, label, icon) in enumerate(nav_items):
            btn = ctk.CTkButton(
                sb,
                text=f"{icon}{label}",
                font=FONT_NORM,
                height=44,
                anchor='w',
                corner_radius=6,
                fg_color='transparent',
                hover_color=C['hover'],
                text_color=C['text2'],
                command=lambda k=key: self._navigate(k),
            )
            btn.pack(fill='x', padx=8, pady=2)
            self._nav_buttons[key] = btn

        # 버전 / 라이센스 정보
        ctk.CTkFrame(sb, height=1, fg_color=C['border']).pack(fill='x', padx=12, pady=8)
        remaining = self.license_info.get('remaining_days', 0)
        exp_text = "무제한" if remaining >= 9999 else f"D-{remaining}"
        ctk.CTkLabel(sb, text=f"v1.0.0  |  {exp_text}",
                     font=FONT_SMALL, text_color=C['text2']).pack(pady=4)

    def _build_log_panel(self):
        log_frame = ctk.CTkFrame(self, height=140, fg_color=C['panel'],
                                  corner_radius=0)
        log_frame.grid(row=2, column=0, columnspan=2, sticky='ew')
        log_frame.grid_propagate(False)
        log_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(log_frame, text=" 거래 로그", font=FONT_SMALL,
                     text_color=C['text2']).grid(row=0, column=0, padx=12, pady=(6, 0), sticky='w')

        self._log_box = ctk.CTkTextbox(
            log_frame, height=100, font=FONT_MONO,
            fg_color=C['bg'], text_color=C['text2'],
            border_width=0, wrap='word', state='disabled',
        )
        self._log_box.grid(row=1, column=0, sticky='ew', padx=6, pady=(0, 6))

    def _navigate(self, key: str):
        # 이전 활성 버튼 해제
        if self._nav_current in self._nav_buttons:
            self._nav_buttons[self._nav_current].configure(
                fg_color='transparent', text_color=C['text2']
            )
        self._nav_current = key
        self._nav_buttons[key].configure(
            fg_color=C['hover'], text_color=C['text']
        )
        # 콘텐츠 전환
        method = getattr(self, f'_show_{key}', None)
        if method:
            method()

    def _clear_content(self):
        if self._content_frame and self._content_frame.winfo_exists():
            self._content_frame.destroy()
        self._content_frame = ctk.CTkScrollableFrame(
            self._main_frame, fg_color=C['bg'], corner_radius=0,
            scrollbar_button_color=C['border'],
        )
        self._content_frame.grid(row=0, column=0, sticky='nsew')
        self._content_frame.grid_columnconfigure(0, weight=1)
        return self._content_frame

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  대시보드
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_dashboard(self):
        self._navigate_internal('dashboard')
        f = self._clear_content()

        # ── 통계 카드 row ─────────────────────────────────────────────
        cards_frame = ctk.CTkFrame(f, fg_color='transparent')
        cards_frame.pack(fill='x', padx=20, pady=(20, 10))
        for i in range(4):
            cards_frame.grid_columnconfigure(i, weight=1)

        self._card_balance  = self._stat_card(cards_frame, "총 잔고",    "$0.00",      C['accent'])
        self._card_pnl      = self._stat_card(cards_frame, "오늘 P&L",   "$0.00",      C['green'])
        self._card_positions= self._stat_card(cards_frame, "활성 포지션", "0개",        C['yellow'])
        self._card_winrate  = self._stat_card(cards_frame, "승률",        "0%",         C['text'])

        self._card_balance.grid(row=0, column=0, padx=(0, 6), sticky='ew')
        self._card_pnl.grid(row=0, column=1, padx=6, sticky='ew')
        self._card_positions.grid(row=0, column=2, padx=6, sticky='ew')
        self._card_winrate.grid(row=0, column=3, padx=(6, 0), sticky='ew')

        # ── 봇 컨트롤 ─────────────────────────────────────────────────
        ctrl = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        ctrl.pack(fill='x', padx=20, pady=8)

        inner = ctk.CTkFrame(ctrl, fg_color='transparent')
        inner.pack(fill='x', padx=20, pady=14)

        self._bot_status_label = ctk.CTkLabel(
            inner, text="● 봇 정지됨",
            font=('Segoe UI', 15, 'bold'), text_color=C['red']
        )
        self._bot_status_label.pack(side='left')

        ctk.CTkLabel(inner, text="  API 연결 후 봇을 시작하세요",
                     font=FONT_SMALL, text_color=C['text2']).pack(side='left')

        # AI 학습 버튼
        self._train_btn = ctk.CTkButton(
            inner, text="  AI 모델 학습",
            font=FONT_SMALL, height=38, width=140,
            fg_color=C['hover'], hover_color=C['border'],
            command=self._start_training
        )
        self._train_btn.pack(side='right', padx=(8, 0))

        # 봇 시작/정지 버튼
        self._bot_btn = ctk.CTkButton(
            inner, text="▶  봇 시작",
            font=('Segoe UI', 14, 'bold'), height=38, width=140,
            fg_color=C['green'], hover_color='#2E8B3E',
            command=self._toggle_bot
        )
        self._bot_btn.pack(side='right')

        # ── 성과 차트 ─────────────────────────────────────────────────
        chart_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        chart_frame.pack(fill='x', padx=20, pady=8)
        ctk.CTkLabel(chart_frame, text=" 수익 곡선 (누적 P&L)",
                     font=FONT_MED, text_color=C['text']).pack(anchor='w', padx=16, pady=(12, 4))
        self._chart_container = ctk.CTkFrame(chart_frame, fg_color='transparent', height=200)
        self._chart_container.pack(fill='x', padx=12, pady=(0, 12))
        self._draw_pnl_chart()

        # ── 최근 거래 ─────────────────────────────────────────────────
        trades_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        trades_frame.pack(fill='x', padx=20, pady=(8, 20))
        ctk.CTkLabel(trades_frame, text=" 최근 거래 내역",
                     font=FONT_MED, text_color=C['text']).pack(anchor='w', padx=16, pady=(12, 4))

        self._trades_table = self._make_table(
            trades_frame,
            headers=['시간', '종목', '방향', '진입가', '점수', '상태'],
            col_widths=[120, 140, 70, 110, 70, 80],
        )
        self._trades_table.pack(fill='x', padx=12, pady=(0, 12))
        self._refresh_trades_table()

    def _stat_card(self, parent, title: str, value: str, color: str):
        card = ctk.CTkFrame(parent, fg_color=C['card'], corner_radius=12)
        ctk.CTkLabel(card, text=title, font=FONT_SMALL,
                     text_color=C['text2']).pack(anchor='w', padx=14, pady=(12, 2))
        label = ctk.CTkLabel(card, text=value, font=FONT_LARGE, text_color=color)
        label.pack(anchor='w', padx=14, pady=(0, 12))
        card._value_label = label
        return card

    def _draw_pnl_chart(self):
        for w in self._chart_container.winfo_children():
            w.destroy()

        trades = []
        if self.trader:
            trades = self.trader.get_trades()

        fig = Figure(figsize=(10, 2.2), dpi=90, facecolor=C['card'])
        ax = fig.add_subplot(111, facecolor=C['bg'])
        fig.subplots_adjust(left=0.06, right=0.99, top=0.88, bottom=0.18)

        if trades:
            cumulative = 0
            x_vals, y_vals = [0], [0]
            for i, t in enumerate(trades):
                cumulative += t.get('pnl', 0)
                x_vals.append(i + 1)
                y_vals.append(cumulative)
            color = C['green'] if y_vals[-1] >= 0 else C['red']
            ax.fill_between(x_vals, 0, y_vals, alpha=0.2, color=color)
            ax.plot(x_vals, y_vals, color=color, linewidth=2)
        else:
            ax.plot([0, 1], [0, 0], color=C['text2'], linewidth=1, linestyle='--')
            ax.text(0.5, 0.5, '거래 내역 없음', ha='center', va='center',
                    transform=ax.transAxes, color=C['text2'], fontsize=11)

        ax.axhline(0, color=C['border'], linewidth=0.8)
        ax.tick_params(colors=C['text2'], labelsize=9)
        ax.spines[:].set_color(C['border'])
        ax.set_ylabel('P&L ($)', color=C['text2'], fontsize=9)

        canvas = FigureCanvasTkAgg(fig, self._chart_container)
        canvas.draw()
        canvas.get_tk_widget().pack(fill='x', expand=True)

    def _make_table(self, parent, headers: list, col_widths: list):
        container = ctk.CTkFrame(parent, fg_color='transparent')
        # 헤더행
        hdr_row = ctk.CTkFrame(container, fg_color=C['hover'], corner_radius=6)
        hdr_row.pack(fill='x', pady=(0, 2))
        for i, (h, w) in enumerate(zip(headers, col_widths)):
            ctk.CTkLabel(hdr_row, text=h, font=FONT_SMALL,
                         text_color=C['text2'], width=w).pack(side='left', padx=4, pady=5)
        container._headers = headers
        container._col_widths = col_widths
        return container

    def _refresh_trades_table(self):
        # 기존 행 제거 (헤더 제외)
        children = self._trades_table.winfo_children()
        for c in children[1:]:
            c.destroy()

        trades = []
        if self.trader:
            trades = self.trader.get_trades()[-10:][::-1]

        for t in trades:
            row = ctk.CTkFrame(self._trades_table, fg_color='transparent', corner_radius=0)
            row.pack(fill='x')
            ctk.CTkFrame(row, height=1, fg_color=C['border']).pack(fill='x')
            inner = ctk.CTkFrame(row, fg_color='transparent')
            inner.pack(fill='x')

            vals = [
                t.get('time', '')[:19],
                t.get('symbol', '').replace('/USDT:USDT', ''),
                t.get('side', ''),
                f"${float(t.get('entry_price', 0)):,.4f}",
                f"{float(t.get('score', 0)):.1f}",
                t.get('status', ''),
            ]
            colors = [C['text'], C['text'], C['green'] if t.get('side') == 'LONG' else C['red'],
                      C['text'], C['accent'], C['text2']]
            for val, color, w in zip(vals, colors, self._trades_table._col_widths):
                ctk.CTkLabel(inner, text=val, font=FONT_SMALL,
                             text_color=color, width=w).pack(side='left', padx=4, pady=4)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  시장분석
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_markets(self):
        self._navigate_internal('markets')
        f = self._clear_content()

        ctk.CTkLabel(f, text="📈  시장 분석", font=FONT_TITLE,
                     text_color=C['text']).pack(anchor='w', padx=20, pady=(20, 4))
        ctk.CTkLabel(f, text="AI 스캔 결과 - 상위 코인별 신호 현황",
                     font=FONT_SMALL, text_color=C['text2']).pack(anchor='w', padx=20, pady=(0, 16))

        # 신호 없으면 안내
        if not self._signals:
            no_data = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
            no_data.pack(fill='x', padx=20, pady=8)
            ctk.CTkLabel(no_data,
                         text="아직 AI 분석 데이터가 없습니다\n봇을 시작하거나 AI 모델 학습을 먼저 진행해주세요",
                         font=FONT_NORM, text_color=C['text2'],
                         justify='center').pack(pady=30)
            return

        # 신호 그리드
        grid = ctk.CTkFrame(f, fg_color='transparent')
        grid.pack(fill='x', padx=20, pady=4)
        for i in range(4):
            grid.grid_columnconfigure(i, weight=1)

        for idx, sig in enumerate(self._signals[:20]):
            row_i = idx // 4
            col_i = idx % 4
            card = self._signal_card(grid, sig)
            card.grid(row=row_i, column=col_i, padx=4, pady=4, sticky='ew')

    def _signal_card(self, parent, sig: dict):
        signal = sig.get('signal', 'HOLD')
        score  = sig.get('score', 50)
        sym    = sig.get('symbol', '').replace('/USDT:USDT', '')
        price  = sig.get('price', 0)

        if signal == 'LONG':
            border_c = C['green']
            sig_c    = C['green']
        elif signal == 'SHORT':
            border_c = C['red']
            sig_c    = C['red']
        else:
            border_c = C['border']
            sig_c    = C['text2']

        card = ctk.CTkFrame(parent, fg_color=C['card'], corner_radius=10,
                             border_width=1, border_color=border_c)

        ctk.CTkLabel(card, text=sym, font=FONT_MED, text_color=C['text']).pack(padx=12, pady=(10, 2))
        ctk.CTkLabel(card, text=f"${price:,.4f}" if price < 1000 else f"${price:,.2f}",
                     font=FONT_SMALL, text_color=C['text2']).pack()
        ctk.CTkLabel(card, text=signal, font=('Segoe UI', 14, 'bold'),
                     text_color=sig_c).pack(pady=4)

        # 점수 바
        bar_frame = ctk.CTkFrame(card, fg_color='transparent')
        bar_frame.pack(fill='x', padx=12, pady=(0, 4))
        ctk.CTkLabel(bar_frame, text=f"{score:.0f}점",
                     font=FONT_SMALL, text_color=C['text2']).pack(side='right')
        bar_bg = ctk.CTkFrame(bar_frame, height=6, fg_color=C['bg'], corner_radius=3)
        bar_bg.pack(fill='x', side='left', expand=True, padx=(0, 6))
        bar_bg.update_idletasks()
        w = bar_bg.winfo_reqwidth()
        bar_w = int(w * score / 100)
        bar_fill = ctk.CTkFrame(bar_bg, height=6, width=bar_w,
                                fg_color=sig_c, corner_radius=3)
        bar_fill.place(x=0, y=0)

        ctk.CTkLabel(card, text=sig.get('reason', '')[:35],
                     font=('Segoe UI', 9), text_color=C['text2'],
                     wraplength=150).pack(padx=8, pady=(0, 8))
        return card

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  AI 신호 상세
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_signals(self):
        self._navigate_internal('signals')
        f = self._clear_content()

        ctk.CTkLabel(f, text="🤖  AI 신호 상세", font=FONT_TITLE,
                     text_color=C['text']).pack(anchor='w', padx=20, pady=(20, 4))

        if not self._signals:
            ctk.CTkLabel(f, text="AI 분석 데이터가 없습니다",
                         font=FONT_NORM, text_color=C['text2']).pack(pady=40)
            return

        # 테이블
        tbl = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        tbl.pack(fill='x', padx=20, pady=8)

        headers = ['종목', '신호', 'AI점수', '기술점수', 'ML점수', '신뢰도', 'RSI', 'MACD', 'BB%', '근거']
        widths  = [100,     70,    70,        70,         70,       70,       60,    80,     60,   200]

        hdr_row = ctk.CTkFrame(tbl, fg_color=C['hover'], corner_radius=8)
        hdr_row.pack(fill='x', padx=8, pady=(8, 2))
        for h, w in zip(headers, widths):
            ctk.CTkLabel(hdr_row, text=h, font=FONT_SMALL,
                         text_color=C['text2'], width=w).pack(side='left', padx=3, pady=6)

        for sig in self._signals:
            signal  = sig.get('signal', 'HOLD')
            score   = sig.get('score', 50)
            inds    = sig.get('indicators', {})
            sig_c   = C['green'] if signal == 'LONG' else (C['red'] if signal == 'SHORT' else C['text2'])

            row = ctk.CTkFrame(tbl, fg_color='transparent')
            row.pack(fill='x', padx=8)
            ctk.CTkFrame(row, height=1, fg_color=C['border']).pack(fill='x')
            inner = ctk.CTkFrame(row, fg_color='transparent')
            inner.pack(fill='x')

            vals   = [
                sig['symbol'].replace('/USDT:USDT', ''),
                signal,
                f"{score:.1f}",
                f"{sig.get('tech_score', 50):.1f}",
                f"{sig.get('ml_score', 50):.1f}",
                f"{sig.get('confidence', 0)*100:.1f}%",
                f"{inds.get('rsi', 0):.1f}",
                f"{inds.get('macd', 0):.4f}",
                f"{inds.get('bb_pct', 0):.2f}",
                sig.get('reason', '')[:40],
            ]
            v_colors = [C['text'], sig_c, C['accent'], C['text'], C['text'],
                        C['text'], C['text'], C['text'], C['text'], C['text2']]
            for val, vc, w in zip(vals, v_colors, widths):
                ctk.CTkLabel(inner, text=val, font=FONT_SMALL,
                             text_color=vc, width=w).pack(side='left', padx=3, pady=5)

        ctk.CTkFrame(tbl, height=8, fg_color='transparent').pack()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  포지션 현황
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_positions(self):
        self._navigate_internal('positions')
        f = self._clear_content()

        ctk.CTkLabel(f, text="💼  활성 포지션", font=FONT_TITLE,
                     text_color=C['text']).pack(anchor='w', padx=20, pady=(20, 4))

        # 전체 청산 버튼
        btns = ctk.CTkFrame(f, fg_color='transparent')
        btns.pack(anchor='e', padx=20, pady=4)
        ctk.CTkButton(btns, text="  전체 청산",
                      font=FONT_NORM, height=34, width=120,
                      fg_color=C['red'], hover_color='#B03030',
                      command=self._close_all_positions).pack(side='right')
        ctk.CTkButton(btns, text="  새로고침",
                      font=FONT_NORM, height=34, width=100,
                      fg_color=C['hover'], hover_color=C['border'],
                      command=lambda: self._show_positions()).pack(side='right', padx=8)

        if not self._positions:
            no_pos = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
            no_pos.pack(fill='x', padx=20, pady=8)
            ctk.CTkLabel(no_pos, text="현재 활성 포지션이 없습니다",
                         font=FONT_NORM, text_color=C['text2']).pack(pady=30)
            return

        tbl = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        tbl.pack(fill='x', padx=20, pady=8)

        headers = ['종목', '방향', '수량', '진입가', '현재가', '미실현P&L', '수익률%', '레버리지', '청산']
        widths  = [130,    70,     80,     110,     110,      110,         80,        70,         80]

        hdr_row = ctk.CTkFrame(tbl, fg_color=C['hover'], corner_radius=8)
        hdr_row.pack(fill='x', padx=8, pady=(8, 2))
        for h, w in zip(headers, widths):
            ctk.CTkLabel(hdr_row, text=h, font=FONT_SMALL,
                         text_color=C['text2'], width=w).pack(side='left', padx=3, pady=6)

        for pos in self._positions:
            pnl  = pos.get('unrealized_pnl', 0)
            pct  = pos.get('percentage', 0)
            side = pos.get('side', '')
            sym  = pos.get('symbol', '')

            side_c = C['green'] if side == 'long' else C['red']
            pnl_c  = C['green'] if pnl >= 0 else C['red']

            row   = ctk.CTkFrame(tbl, fg_color='transparent')
            row.pack(fill='x', padx=8)
            ctk.CTkFrame(row, height=1, fg_color=C['border']).pack(fill='x')
            inner = ctk.CTkFrame(row, fg_color='transparent')
            inner.pack(fill='x')

            vals   = [
                sym.replace('/USDT:USDT', ''),
                side.upper(),
                f"{pos.get('size', 0):.4f}",
                f"${pos.get('entry_price', 0):,.4f}",
                f"${pos.get('mark_price', 0):,.4f}",
                f"${pnl:+.2f}",
                f"{pct:+.1f}%",
                f"{pos.get('leverage', 1):.0f}x",
            ]
            v_colors = [C['text'], side_c, C['text'], C['text'],
                        C['text'], pnl_c, pnl_c, C['text2']]

            for val, vc, w in zip(vals, v_colors, widths[:-1]):
                ctk.CTkLabel(inner, text=val, font=FONT_SMALL,
                             text_color=vc, width=w).pack(side='left', padx=3, pady=5)

            ctk.CTkButton(inner, text="청산", font=FONT_SMALL,
                          height=26, width=widths[-1]-8,
                          fg_color=C['red'], hover_color='#A02020',
                          command=lambda s=sym, sd=side, sz=pos.get('size', 0): self._close_one(s, sd, sz)
                          ).pack(side='left', padx=4)

        ctk.CTkFrame(tbl, height=8, fg_color='transparent').pack()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  설정
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_settings(self):
        self._navigate_internal('settings')
        f = self._clear_content()

        ctk.CTkLabel(f, text="⚙️  설정", font=FONT_TITLE,
                     text_color=C['text']).pack(anchor='w', padx=20, pady=(20, 4))

        # ── API 설정 ──────────────────────────────────────────────────
        api_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        api_frame.pack(fill='x', padx=20, pady=8)
        ctk.CTkLabel(api_frame, text="  Bitget API 설정", font=FONT_MED,
                     text_color=C['accent']).pack(anchor='w', padx=16, pady=(12, 8))

        self._entries = {}
        api_fields = [
            ('api_key',        'API Key',        False),
            ('api_secret',     'API Secret',     True),
            ('api_passphrase', 'Passphrase',     True),
        ]
        for key, label, secret in api_fields:
            row = ctk.CTkFrame(api_frame, fg_color='transparent')
            row.pack(fill='x', padx=16, pady=4)
            ctk.CTkLabel(row, text=label, font=FONT_SMALL, width=130,
                         text_color=C['text2']).pack(side='left')
            ent = ctk.CTkEntry(row, show='*' if secret else '',
                               font=FONT_MONO, fg_color=C['bg'],
                               border_color=C['border'], height=34)
            ent.insert(0, self.config.get(key, ''))
            ent.pack(side='left', fill='x', expand=True)
            self._entries[key] = ent

        ctk.CTkButton(api_frame, text="  연결 테스트",
                      font=FONT_NORM, height=34, width=130,
                      fg_color=C['accent'], hover_color='#1F6FD0',
                      command=self._test_api_connection).pack(anchor='e', padx=16, pady=8)

        # ── 트레이딩 설정 ─────────────────────────────────────────────
        trade_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        trade_frame.pack(fill='x', padx=20, pady=8)
        ctk.CTkLabel(trade_frame, text="  트레이딩 설정", font=FONT_MED,
                     text_color=C['accent']).pack(anchor='w', padx=16, pady=(12, 8))

        trade_fields = [
            ('leverage',       '레버리지 (배수)',      '5'),
            ('risk_per_trade', '거래당 리스크 (%)',    '2.0'),
            ('max_positions',  '최대 동시 포지션',      '5'),
            ('min_score',      '최소 AI 점수',         '65'),
            ('sl_atr_multiplier', 'SL ATR 배수',       '1.5'),
            ('tp_ratio',       'TP/SL 비율',           '2.0'),
            ('scan_interval',  '스캔 주기 (초)',        '300'),
            ('top_coins',      '스캔 코인 수',          '20'),
            ('max_daily_loss', '일일 최대 손실 (%)',    '10'),
            ('cool_down_hours','재진입 쿨다운 (시간)',  '2'),
        ]

        for key, label, default in trade_fields:
            row = ctk.CTkFrame(trade_frame, fg_color='transparent')
            row.pack(fill='x', padx=16, pady=3)
            ctk.CTkLabel(row, text=label, font=FONT_SMALL, width=180,
                         text_color=C['text2']).pack(side='left')
            ent = ctk.CTkEntry(row, font=FONT_NORM, fg_color=C['bg'],
                               border_color=C['border'], height=32, width=120)
            val = self.config.get(key, default)
            ent.insert(0, str(val))
            ent.pack(side='left')
            self._entries[key] = ent

        # 저장 버튼
        ctk.CTkButton(trade_frame, text="  설정 저장",
                      font=FONT_MED, height=38, width=140,
                      fg_color=C['green'], hover_color='#2E8B3E',
                      command=self._save_settings).pack(anchor='e', padx=16, pady=12)

    def _test_api_connection(self):
        self._apply_api_from_entries()
        try:
            ok = self.exchange.test_connection()
            if ok:
                self._show_toast("API 연결 성공!", C['green'])
                self.logger.info("API 연결 테스트 성공")
            else:
                self._show_toast("API 연결 실패", C['red'])
        except Exception as e:
            self._show_toast(f"연결 오류: {e}", C['red'])

    def _apply_api_from_entries(self):
        for key in ('api_key', 'api_secret', 'api_passphrase'):
            if key in self._entries:
                self.config.set(key, self._entries[key].get())
        self.exchange.api_key     = self.config.get('api_key', '')
        self.exchange.secret      = self.config.get('api_secret', '')
        self.exchange.passphrase  = self.config.get('api_passphrase', '')

    def _save_settings(self):
        self._apply_api_from_entries()
        num_keys = ['leverage', 'risk_per_trade', 'max_positions', 'min_score',
                    'sl_atr_multiplier', 'tp_ratio', 'scan_interval', 'top_coins',
                    'max_daily_loss', 'cool_down_hours']
        for key in num_keys:
            if key in self._entries:
                try:
                    val = float(self._entries[key].get())
                    if key in ('leverage', 'max_positions', 'scan_interval',
                               'top_coins', 'cool_down_hours'):
                        val = int(val)
                    self.config.set(key, val)
                except ValueError:
                    pass
        self._show_toast("설정이 저장되었습니다!", C['green'])
        self.logger.info("설정 저장 완료")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  라이센스
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _show_license(self):
        self._navigate_internal('license')
        f = self._clear_content()

        ctk.CTkLabel(f, text="🔑  라이센스 정보", font=FONT_TITLE,
                     text_color=C['text']).pack(anchor='w', padx=20, pady=(20, 4))

        info_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        info_frame.pack(fill='x', padx=20, pady=8)

        li = self.license_info
        is_unlimited = li.get('tier') == 'UNLIMITED'
        remaining = li.get('remaining_days', 0)

        rows = [
            ("라이센스 종류",   "무제한권 (평생)" if is_unlimited else "달권 (월간)",
             C['accent'] if is_unlimited else C['yellow']),
            ("만료일",          li.get('expiry', '-'),      C['text']),
            ("남은 기간",        "무제한" if remaining >= 9999 else f"D-{remaining} ({remaining}일)",
             C['green'] if remaining > 7 or is_unlimited else C['red']),
            ("하드웨어 ID",     li.get('hwid', '-')[:48] + '...', C['text2']),
        ]

        for label, value, vc in rows:
            row = ctk.CTkFrame(info_frame, fg_color='transparent')
            row.pack(fill='x', padx=20, pady=8)
            ctk.CTkLabel(row, text=label, font=FONT_NORM, width=140,
                         text_color=C['text2']).pack(side='left')
            ctk.CTkLabel(row, text=value, font=FONT_MED,
                         text_color=vc).pack(side='left')

        # 갱신 안내
        ctk.CTkFrame(f, height=1, fg_color=C['border']).pack(fill='x', padx=20, pady=8)
        ctk.CTkLabel(f, text="라이센스 갱신 또는 신규 발급",
                     font=FONT_MED, text_color=C['text']).pack(anchor='w', padx=20)
        ctk.CTkLabel(f,
                     text="만료 후에도 위의 하드웨어 ID를 판매자에게 전달하면\n새 라이센스 키를 받을 수 있습니다.",
                     font=FONT_SMALL, text_color=C['text2'],
                     justify='left').pack(anchor='w', padx=20, pady=4)

        new_frame = ctk.CTkFrame(f, fg_color=C['card'], corner_radius=12)
        new_frame.pack(fill='x', padx=20, pady=8)
        ctk.CTkLabel(new_frame, text="새 라이센스 키 입력",
                     font=FONT_MED, text_color=C['text']).pack(anchor='w', padx=16, pady=(12, 4))
        new_entry = ctk.CTkEntry(new_frame, placeholder_text="새 키를 붙여넣으세요...",
                                  font=FONT_MONO, height=36, fg_color=C['bg'],
                                  border_color=C['border'])
        new_entry.pack(fill='x', padx=16, pady=4)
        ctk.CTkButton(new_frame, text="  라이센스 갱신",
                      font=FONT_NORM, height=34, width=130,
                      fg_color=C['accent'], hover_color='#1F6FD0',
                      command=lambda: self._renew_license(new_entry.get())
                      ).pack(anchor='e', padx=16, pady=8)

    def _renew_license(self, key: str):
        if not key.strip():
            self._show_toast("키를 입력해주세요", C['red'])
            return
        info = validate_license(key.strip())
        if info['valid']:
            save_license(key.strip())
            self.license_info = info
            self._show_toast("라이센스가 갱신되었습니다!", C['green'])
            self._show_license()
        else:
            self._show_toast(info.get('error', '인증 실패'), C['red'])

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  봇 제어
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _toggle_bot(self):
        if self.trader and self.trader.is_running():
            self._stop_bot()
        else:
            self._start_bot()

    def _start_bot(self):
        if not self.config.get('api_key'):
            self._show_toast("먼저 API 키를 설정해주세요", C['red'])
            return

        try:
            # 거래소 연결
            self.exchange.api_key    = self.config.get('api_key', '')
            self.exchange.secret     = self.config.get('api_secret', '')
            self.exchange.passphrase = self.config.get('api_passphrase', '')
            self.exchange.connect()

            # 트레이더 생성 및 시작
            self.trader = Trader(self.exchange, self.ai, self.config, self.logger)
            self.trader.on_signal       = self._on_new_signals
            self.trader.on_trade        = self._on_new_trade
            self.trader.on_stats_update = self._on_stats_update

            self.trader.start()

            self._bot_btn.configure(text="■  봇 정지",
                                    fg_color=C['red'], hover_color='#A02020')
            self._bot_status_label.configure(text="● 봇 실행 중", text_color=C['green'])
            self._status_dot.configure(text="● 실행 중", text_color=C['green'])
            self.logger.info("봇 시작")
        except Exception as e:
            self._show_toast(f"봇 시작 실패: {e}", C['red'])
            self.logger.error(f"봇 시작 오류: {e}")

    def _stop_bot(self):
        if self.trader:
            self.trader.stop()
        self._bot_btn.configure(text="▶  봇 시작",
                                fg_color=C['green'], hover_color='#2E8B3E')
        self._bot_status_label.configure(text="● 봇 정지됨", text_color=C['red'])
        self._status_dot.configure(text="● 정지", text_color=C['red'])

    def _start_training(self):
        if not self.config.get('api_key'):
            self._show_toast("먼저 API 키를 설정해주세요", C['red'])
            return

        self._train_btn.configure(text="  학습 중...", state='disabled')
        self.logger.ai("AI 모델 학습 시작...")

        def _train_thread():
            try:
                self.exchange.api_key    = self.config.get('api_key', '')
                self.exchange.secret     = self.config.get('api_secret', '')
                self.exchange.passphrase = self.config.get('api_passphrase', '')
                if not self.exchange.is_connected():
                    self.exchange.connect()

                symbols = self.exchange.get_top_symbols(self.config.get('top_coins', 20))
                data = []
                for i, sym in enumerate(symbols):
                    try:
                        df = self.exchange.get_ohlcv(sym, '1h', 2000)
                        data.append((sym, df))
                        self.logger.ai(f"  데이터 수집: {sym} ({i+1}/{len(symbols)})")
                        time.sleep(0.2)
                    except Exception:
                        pass

                self.logger.ai(f"총 {len(data)}개 종목 데이터로 모델 학습 중...")
                ok = self.ai.train(data, callback=lambda p: None)

                if ok:
                    self.logger.ai("AI 모델 학습 완료!")
                    self.after(0, lambda: self._show_toast("AI 모델 학습 완료!", C['green']))
                else:
                    self.logger.error("AI 모델 학습 실패")
                    self.after(0, lambda: self._show_toast("학습 실패", C['red']))
            except Exception as e:
                self.logger.error(f"학습 오류: {e}")
                self.after(0, lambda: self._show_toast(f"학습 오류: {e}", C['red']))
            finally:
                self.after(0, lambda: self._train_btn.configure(
                    text="  AI 모델 학습", state='normal'))

        threading.Thread(target=_train_thread, daemon=True).start()

    def _close_all_positions(self):
        if not self.exchange.is_connected():
            self._show_toast("거래소에 연결되어 있지 않습니다", C['red'])
            return
        try:
            results = self.exchange.close_all_positions()
            ok = sum(1 for r in results if r.get('success'))
            self._show_toast(f"{ok}/{len(results)}개 포지션 청산", C['yellow'])
            self.logger.trade(f"전체 청산: {ok}/{len(results)}")
        except Exception as e:
            self._show_toast(f"청산 오류: {e}", C['red'])

    def _close_one(self, symbol: str, side: str, size: float):
        if not self.exchange.is_connected():
            self._show_toast("거래소에 연결되어 있지 않습니다", C['red'])
            return
        try:
            self.exchange.close_position(symbol, side, size)
            self._show_toast(f"{symbol} 청산 완료", C['green'])
            self.logger.trade(f"수동 청산: {symbol}")
            self.after(500, self._show_positions)
        except Exception as e:
            self._show_toast(f"청산 오류: {e}", C['red'])

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  백그라운드 태스크 / 업데이트
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def _start_background_tasks(self):
        """포지션 + 잔고 주기적 갱신"""
        def _balance_loop():
            while True:
                try:
                    if self.exchange.is_connected():
                        self._balance = self.exchange.get_balance()
                        self._positions = self.exchange.get_positions()
                except Exception:
                    pass
                time.sleep(10)

        threading.Thread(target=_balance_loop, daemon=True).start()

    def _update_timer(self):
        """메인 스레드 UI 업데이트 (1초마다)"""
        try:
            self._process_update_queue()
            self._update_header_stats()
            if self._nav_current == 'dashboard':
                self._update_dashboard_cards()
        except Exception:
            pass
        self.after(1000, self._update_timer)

    def _process_update_queue(self):
        while not self._update_queue.empty():
            try:
                item = self._update_queue.get_nowait()
                if item['type'] == 'log':
                    self._append_log(item['text'], item['level'])
                elif item['type'] == 'signals':
                    self._signals = item['data']
                elif item['type'] == 'stats':
                    pass  # 통계는 카드에서 직접 읽음
            except queue.Empty:
                break

    def _update_header_stats(self):
        total = self._balance.get('total', 0)
        self._balance_label.configure(text=f"USDT: ${total:,.2f}")

    def _update_dashboard_cards(self):
        try:
            total = self._balance.get('total', 0)
            initial = self.trader.stats['initial_balance'] if self.trader else 0
            daily_pnl = total - initial if initial > 0 else 0

            if hasattr(self, '_card_balance') and self._card_balance.winfo_exists():
                self._card_balance._value_label.configure(text=f"${total:,.2f}")

                pnl_c = C['green'] if daily_pnl >= 0 else C['red']
                if hasattr(self, '_card_pnl') and self._card_pnl.winfo_exists():
                    self._card_pnl._value_label.configure(
                        text=f"${daily_pnl:+,.2f}", text_color=pnl_c)

                pos_count = len(self._positions)
                if hasattr(self, '_card_positions') and self._card_positions.winfo_exists():
                    self._card_positions._value_label.configure(text=f"{pos_count}개")

                if self.trader:
                    stats = self.trader.get_stats()
                    total_t = stats.get('total_trades', 0)
                    win_t   = stats.get('win_trades', 0)
                    wr = (win_t / total_t * 100) if total_t > 0 else 0
                    if hasattr(self, '_card_winrate') and self._card_winrate.winfo_exists():
                        self._card_winrate._value_label.configure(text=f"{wr:.1f}%")
        except Exception:
            pass

    def _on_log(self, line: str, level: str):
        self._update_queue.put({'type': 'log', 'text': line, 'level': level})

    def _on_new_signals(self, signals: list):
        self._signals = signals
        self._update_queue.put({'type': 'signals', 'data': signals})

    def _on_new_trade(self, trade: dict):
        self.logger.trade(f"신규 거래: {trade['symbol']} {trade['side']}")

    def _on_stats_update(self, stats: dict):
        self._update_queue.put({'type': 'stats', 'data': stats})

    def _append_log(self, text: str, level: str = 'INFO'):
        if not hasattr(self, '_log_box') or not self._log_box.winfo_exists():
            return
        color_map = {
            'TRADE': C['green'],
            'ERROR': C['red'],
            'WARN':  C['yellow'],
            'AI':    C['accent'],
            'INFO':  C['text2'],
        }
        self._log_box.configure(state='normal')
        self._log_box.insert('end', text + '\n')
        self._log_box.see('end')
        self._log_box.configure(state='disabled')

    def _show_toast(self, msg: str, color: str = C['accent'], duration: int = 2500):
        toast = ctk.CTkFrame(self, fg_color=color, corner_radius=10)
        toast.place(relx=0.5, rely=0.95, anchor='s')
        ctk.CTkLabel(toast, text=f"  {msg}  ", font=FONT_NORM,
                     text_color='white').pack(padx=8, pady=8)
        self.after(duration, toast.destroy)

    def _navigate_internal(self, key: str):
        """실제 네비게이션 상태 설정 (내부용, 이벤트 없이)"""
        for k, btn in self._nav_buttons.items():
            if k == key:
                btn.configure(fg_color=C['hover'], text_color=C['text'])
            else:
                btn.configure(fg_color='transparent', text_color=C['text2'])
        self._nav_current = key

    def _refresh_trades_table(self):
        pass  # dashboard 빌드 시 호출되는 placeholder


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  앱 실행 진입점
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def run():
    """메인 진입점 - 라이센스 체크 후 앱 실행"""
    # 스플래시 창
    splash = ctk.CTk()
    splash.title("BitgetAI Pro")
    splash.geometry("420x200")
    splash.resizable(False, False)
    splash.configure(fg_color=C['bg'])
    splash.update_idletasks()
    sw = splash.winfo_screenwidth()
    sh = splash.winfo_screenheight()
    splash.geometry(f"+{(sw-420)//2}+{(sh-200)//2}")

    ctk.CTkLabel(splash, text="⚡ BitgetAI Pro",
                 font=('Segoe UI', 28, 'bold'), text_color=C['accent']).pack(pady=(30, 4))
    ctk.CTkLabel(splash, text="AI 자동매매 시스템 로딩 중...",
                 font=FONT_SMALL, text_color=C['text2']).pack()
    pb = ctk.CTkProgressBar(splash, width=300, mode='indeterminate',
                             fg_color=C['border'], progress_color=C['accent'])
    pb.pack(pady=20)
    pb.start()
    splash.update()

    # 라이센스 확인
    license_info = get_license_info()

    pb.stop()
    splash.destroy()

    if not license_info.get('valid'):
        # 라이센스 없음 -> 로그인 다이얼로그
        temp = ctk.CTk()
        temp.geometry("1x1")
        temp.withdraw()

        dlg = LoginDialog(temp)
        temp.wait_window(dlg)

        if dlg.result and dlg.result.get('valid'):
            license_info = dlg.result
        else:
            temp.destroy()
            return  # 인증 실패 -> 종료

        temp.destroy()

    # 메인 앱 실행
    app = BitgetAIApp(license_info)
    app.mainloop()
