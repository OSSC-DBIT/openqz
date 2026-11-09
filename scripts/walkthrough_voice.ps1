# Speak the walkthrough narration with the free Windows text-to-speech engine (no download needed).
#   powershell -File scripts/walkthrough_voice.ps1 -OutDir recordings/<date-time>
# Writes voice-<id>.wav for every segment in scripts/walkthrough_narration.json.
param([Parameter(Mandatory = $true)][string]$OutDir)

Add-Type -AssemblyName System.Speech
$cfg = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'walkthrough_narration.json') | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice($cfg.voice) } catch { Write-Warning "Voice '$($cfg.voice)' not found; using the default voice." }
$synth.Rate = [int]$cfg.rate
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($seg in $cfg.segments) {
  $path = Join-Path (Resolve-Path $OutDir) "voice-$($seg.id).wav"
  $synth.SetOutputToWaveFile($path, $format)
  $synth.Speak($seg.text)
  $synth.SetOutputToNull()
  Write-Output "voice-$($seg.id).wav"
}
$synth.Dispose()
