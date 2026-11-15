; Mars Map installer (Inno Setup 6). Built by GitHub Actions ("Windows app") or locally:
;   "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" desktop\installer.iss
; Needs dist-desktop\MarsMap.exe first (desktop\build_windows.bat builds both).
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppName "Mars Map"
#define MyAppExe "MarsMap.exe"

[Setup]
AppId={{8F3C2A51-6B7E-4C1D-9A2F-3E5D7B9C1A20}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=Mars Map team
AppPublisherURL=https://github.com/AhmadjonY/MarsMap
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Installs for the current user without administrator rights (an admin can still choose "all users").
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist-desktop
OutputBaseFilename=MarsMap-Setup
SetupIconFile=mars.ico
UninstallDisplayIcon={app}\{#MyAppExe}
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist-desktop\MarsMap.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Caches only; %LOCALAPPDATA%\MarsMap\settings.env (your Gemini key) is kept.
Type: filesandordirs; Name: "{localappdata}\MarsMap\dem"
Type: filesandordirs; Name: "{localappdata}\MarsMap\webview"
Type: files; Name: "{localappdata}\MarsMap\last-url.txt"

[Code]
const
  WebView2Key = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Download = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasVersion(RootKey: Integer; SubKey: String): Boolean;
var
  Version: String;
begin
  Result := False;
  if RegQueryStringValue(RootKey, SubKey, 'pv', Version) then
    Result := (Version <> '') and (Version <> '0.0.0.0');
end;

function WebView2Installed(): Boolean;
begin
  Result := HasVersion(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2Key);
  if not Result then
    Result := HasVersion(HKLM, 'SOFTWARE\' + WebView2Key);
  if not Result then
    Result := HasVersion(HKCU, 'Software\' + WebView2Key);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if (CurStep = ssPostInstall) and (not WizardSilent()) and (not WebView2Installed()) then
  begin
    if MsgBox('Mars Map needs the free Microsoft Edge WebView2 Runtime (already part of Windows 11).' + #13#10 +
              'Для работы Mars Map нужен бесплатный Microsoft Edge WebView2 Runtime.' + #13#10#13#10 +
              'Open the Microsoft download page now? / Открыть страницу загрузки?', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', WebView2Download, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;
