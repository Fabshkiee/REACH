import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile as wf } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const InspectWindowsSchema = z.object({
  query: z.string().max(100).optional().describe("Optional substring filter for window title or process name"),
});
export type InspectWindowsInput = z.infer<typeof InspectWindowsSchema>;

export const FocusWindowSchema = z.object({
  title: z.string().min(1).max(200).describe("Application process name or window title substring to focus (e.g. 'Discord', 'Figma', 'Spotify')"),
});
export type FocusWindowInput = z.infer<typeof FocusWindowSchema>;

export const TypeTextSchema = z.object({
  text: z.string().max(10000).describe("Text to type into the active window"),
  submit: z.boolean().optional().describe("If true, presses Enter after typing (submits/sends message)"),
  useClipboard: z.boolean().optional().describe("If true or text is long/multiline, pastes via clipboard for 100% fidelity"),
});
export type TypeTextInput = z.infer<typeof TypeTextSchema>;

export const SendHotkeySchema = z.object({
  keys: z.array(z.string().min(1).max(20)).min(1).max(5).describe("Key combination (e.g. ['ctrl', 'k'], ['ctrl', 'o'], ['alt', 'tab'], ['enter'], ['escape'])"),
});
export type SendHotkeyInput = z.infer<typeof SendHotkeySchema>;

export const SetClipboardSchema = z.object({
  text: z.string().max(100000).describe("Text to copy into the Windows system clipboard"),
});
export type SetClipboardInput = z.infer<typeof SetClipboardSchema>;

export const GetClipboardSchema = z.object({});
export type GetClipboardInput = z.infer<typeof GetClipboardSchema>;

async function runPowerShell(scriptBody: string, args: string[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reach-desktop-"));
  const scriptPath = join(dir, "action.ps1");
  try {
    await wf(scriptPath, scriptBody, "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("desktop action timed out after 15s"));
      }, 15_000);
      timer.unref?.();
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`powershell failed to start: ${err.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr.trim() || `powershell exit ${code}`));
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function inspectWindows(input: InspectWindowsInput = {}): Promise<{ ok: true; windows: Array<{ id: number; process: string; title: string }> }> {
  const script = `
param([string]$filter)
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object {
  [PSCustomObject]@{
    id = $_.Id
    process = $_.ProcessName
    title = $_.MainWindowTitle.Trim()
  }
}
if ($filter) {
  $f = $filter.ToLower()
  $procs = $procs | Where-Object { $_.title.ToLower().Contains($f) -or $_.process.ToLower().Contains($f) }
}
$list = @($procs | Select-Object -First 30)
[PSCustomObject]@{ ok = $true; windows = $list } | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, [input.query ?? ""]);
  try {
    const parsed = JSON.parse(raw);
    const windows = Array.isArray(parsed.windows) ? parsed.windows : parsed.windows ? [parsed.windows] : [];
    return { ok: true, windows };
  } catch {
    return { ok: true, windows: [] };
  }
}

export async function focusWindow(input: FocusWindowInput): Promise<{ ok: boolean; focused: boolean; title?: string; process?: string; error?: string }> {
  const target = input.title.trim();
  const script = `
param([string]$target)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName Microsoft.VisualBasic
$wshell = New-Object -ComObject WScript.Shell
$t = $target.ToLower()

$matches = Get-Process | Where-Object {
  $_.MainWindowTitle -and (
    $_.MainWindowTitle.ToLower().Contains($t) -or
    $_.ProcessName.ToLower().Contains($t)
  )
}

if ($matches) {
  $proc = $matches[0]
  $focused = $wshell.AppActivate($proc.Id)
  if ($focused) {
    [PSCustomObject]@{ ok = $true; focused = $true; title = $proc.MainWindowTitle; process = $proc.ProcessName; id = $proc.Id } | ConvertTo-Json -Compress
    exit 0
  }
}

$direct = $wshell.AppActivate($target)
if ($direct) {
  [PSCustomObject]@{ ok = $true; focused = $true; title = $target } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{ ok = $false; error = "Window matching '$target' not found or could not be focused" } | ConvertTo-Json -Compress
exit 1
`;
  try {
    const raw = await runPowerShell(script, [target]);
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    return { ok: false, focused: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function typeText(input: TypeTextInput): Promise<{ ok: boolean; typedLength: number; submitted: boolean; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reach-type-"));
  const textFile = join(dir, "text.txt");
  try {
    await wf(textFile, input.text, "utf8");
    const script = `
param([string]$textFilePath, [string]$submitFlag, [string]$clipboardFlag)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

$text = [System.IO.File]::ReadAllText($textFilePath, [System.Text.Encoding]::UTF8)
$doSubmit = ($submitFlag -eq "1" -or $submitFlag -eq "true")
$useClip = ($clipboardFlag -eq "1" -or $clipboardFlag -eq "true" -or $text.Length -gt 30 -or $text.Contains("\`n"))

if ($useClip) {
  Set-Clipboard -Value $text
  Start-Sleep -Milliseconds 60
  [System.Windows.Forms.SendKeys]::SendWait("^v")
} else {
  $escaped = ""
  for ($i = 0; $i -lt $text.Length; $i++) {
    $c = $text[$i]
    if ("+^%~(){}[]".IndexOf($c) -ge 0) {
      $escaped += "{$c}"
    } else {
      $escaped += $c
    }
  }
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
}

if ($doSubmit) {
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

[PSCustomObject]@{ ok = $true; typedLength = $text.Length; submitted = $doSubmit } | ConvertTo-Json -Compress
`;
    const submitArg = input.submit ? "1" : "0";
    const clipArg = input.useClipboard === true ? "1" : input.useClipboard === false ? "0" : "";
    const raw = await runPowerShell(script, [textFile, submitArg, clipArg]);
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    return { ok: false, typedLength: 0, submitted: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function sendHotkey(input: SendHotkeyInput): Promise<{ ok: boolean; hotkey: string; error?: string }> {
  const keysArg = input.keys.join(",");
  const script = `
param([string]$keysArg)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

$rawKeys = $keysArg -split ","
$modifiers = ""
$baseKey = ""

foreach ($k in $rawKeys) {
  $norm = $k.Trim().ToLower()
  switch ($norm) {
    "ctrl"     { $modifiers += "^" }
    "control"  { $modifiers += "^" }
    "alt"      { $modifiers += "%" }
    "shift"    { $modifiers += "+" }
    "enter"    { $baseKey = "{ENTER}" }
    "return"   { $baseKey = "{ENTER}" }
    "esc"      { $baseKey = "{ESC}" }
    "escape"   { $baseKey = "{ESC}" }
    "tab"      { $baseKey = "{TAB}" }
    "space"    { $baseKey = " " }
    "backspace"{ $baseKey = "{BACKSPACE}" }
    "up"       { $baseKey = "{UP}" }
    "down"     { $baseKey = "{DOWN}" }
    "left"     { $baseKey = "{LEFT}" }
    "right"    { $baseKey = "{RIGHT}" }
    "home"     { $baseKey = "{HOME}" }
    "end"      { $baseKey = "{END}" }
    "delete"   { $baseKey = "{DEL}" }
    "f1"       { $baseKey = "{F1}" }
    "f2"       { $baseKey = "{F2}" }
    "f3"       { $baseKey = "{F3}" }
    "f4"       { $baseKey = "{F4}" }
    "f5"       { $baseKey = "{F5}" }
    "f6"       { $baseKey = "{F6}" }
    "f7"       { $baseKey = "{F7}" }
    "f8"       { $baseKey = "{F8}" }
    "f9"       { $baseKey = "{F9}" }
    "f10"      { $baseKey = "{F10}" }
    "f11"      { $baseKey = "{F11}" }
    "f12"      { $baseKey = "{F12}" }
    default {
      if ($norm.Length -eq 1) {
        $baseKey = $norm
      }
    }
  }
}

$chord = "$modifiers$baseKey"
if (-not $chord) {
  [PSCustomObject]@{ ok = $false; error = "Invalid hotkey chord: '$keysArg'" } | ConvertTo-Json -Compress
  exit 1
}

[System.Windows.Forms.SendKeys]::SendWait($chord)
[PSCustomObject]@{ ok = $true; hotkey = $chord } | ConvertTo-Json -Compress
`;
  try {
    const raw = await runPowerShell(script, [keysArg]);
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    return { ok: false, hotkey: keysArg, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setClipboard(input: SetClipboardInput): Promise<{ ok: boolean; length: number; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reach-clip-"));
  const textFile = join(dir, "clip.txt");
  try {
    await wf(textFile, input.text, "utf8");
    const script = `
param([string]$textFilePath)
$ErrorActionPreference = 'SilentlyContinue'
$text = [System.IO.File]::ReadAllText($textFilePath, [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $text
[PSCustomObject]@{ ok = $true; length = $text.Length } | ConvertTo-Json -Compress
`;
    const raw = await runPowerShell(script, [textFile]);
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    return { ok: false, length: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function getClipboard(): Promise<{ ok: boolean; text: string; error?: string }> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$val = Get-Clipboard
[PSCustomObject]@{ ok = $true; text = if ($val) { $val } else { "" } } | ConvertTo-Json -Compress
`;
  try {
    const raw = await runPowerShell(script);
    const parsed = JSON.parse(raw);
    return { ok: true, text: typeof parsed.text === "string" ? parsed.text : "" };
  } catch (err) {
    return { ok: false, text: "", error: err instanceof Error ? err.message : String(err) };
  }
}
