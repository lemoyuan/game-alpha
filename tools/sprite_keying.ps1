# Turn AI-generated flat-background sprites into game-ready textures:
# sample the background color -> mask the watermark corner -> chroma-key with despill
# -> trim to content bbox -> scale to target -> center on a transparent square canvas
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/sprite_keying.ps1 [-Sheet] [-Zoom 4]
# NOTE: keep this file ASCII-only; Windows PowerShell 5.1 reads .ps1 as ANSI and chokes on BOM-less UTF-8.
param(
  [string]$Src = 'vibe_images',
  [string]$Dst = 'images/entity',
  [int]$Zoom = 2,
  [switch]$Sheet
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;

public static class SpriteKit {
  const int T0 = 45;   // within this color distance of the background -> fully transparent
  const int T1 = 120;  // beyond this -> fully opaque; in between is the antialiased ramp

  static readonly int[] DX = { 1, -1, 0, 0 };
  static readonly int[] DY = { 0, 0, 1, -1 };

  static double Dist(double r0, double g0, double b0, double r1, double g1, double b1) {
    double a = r0 - r1, c = g0 - g1, e = b0 - b1;
    return Math.Sqrt(a * a + c * c + e * e);
  }

  static Color KeyColor(Bitmap b) {
    int W = b.Width, H = b.Height;
    var rs = new List<int>(); var gs = new List<int>(); var bs = new List<int>();
    Action<int, int> take = (x, y) => {
      if (x > W * 0.72 && y > H * 0.88) return; // skip the watermark corner
      var c = b.GetPixel(x, y);
      rs.Add(c.R); gs.Add(c.G); bs.Add(c.B);
    };
    for (int x = 0; x < W; x += 8) { take(x, 2); take(x, H - 3); }
    for (int y = 0; y < H; y += 8) { take(2, y); take(W - 3, y); }
    rs.Sort(); gs.Sort(); bs.Sort();
    int m = rs.Count / 2;
    return Color.FromArgb(rs[m], gs[m], bs[m]);
  }

  public static string Process(string srcPath, string dstPath, int target) {
    Color key;
    using (var raw = new Bitmap(srcPath)) {
      var bmp = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) g.DrawImage(raw, 0, 0, raw.Width, raw.Height);
      key = KeyColor(bmp);

      int W = bmp.Width, H = bmp.Height;
      var rect = new Rectangle(0, 0, W, H);
      var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      byte[] px = new byte[Math.Abs(data.Stride) * H];
      Marshal.Copy(data.Scan0, px, 0, px.Length);
      int s = data.Stride;

      // Paint the bottom-right watermark band with the background color so it keys out with the rest.
      for (int y = (int)(H * 0.88); y < H; y++) {
        for (int x = (int)(W * 0.72); x < W; x++) {
          int i = y * s + x * 4;
          px[i] = key.B; px[i + 1] = key.G; px[i + 2] = key.R; px[i + 3] = 255;
        }
      }

      int minX = W, minY = H, maxX = -1, maxY = -1;
      double dr = key.R, dg = key.G, db = key.B;

      // Stage 1: global chroma distance. The sprites have soft internal shading, so any
      // connectivity-based fill wanders straight into the body; distance alone keeps it intact.
      for (int y = 0; y < H; y++) {
        for (int x = 0; x < W; x++) {
          int i = y * s + x * 4;
          double b0 = px[i], g0 = px[i + 1], r0 = px[i + 2];
          double d = Dist(r0, g0, b0, dr, dg, db);
          double a;
          if (d <= T0) a = 0;
          else if (d >= T1) a = 255;
          else a = 255.0 * (d - T0) / (T1 - T0);
          if (a <= 8) { px[i + 3] = 0; continue; }
          if (a < 255) { // unblend against the background so edges keep their own hue
            double al = a / 255.0;
            r0 = (r0 - (1 - al) * dr) / al;
            g0 = (g0 - (1 - al) * dg) / al;
            b0 = (b0 - (1 - al) * db) / al;
          }
          px[i] = (byte)Math.Max(0, Math.Min(255, b0));
          px[i + 1] = (byte)Math.Max(0, Math.Min(255, g0));
          px[i + 2] = (byte)Math.Max(0, Math.Min(255, r0));
          px[i + 3] = (byte)a;
        }
      }

      // Stage 2: the generated background is a gradient, so its far end survives stage 1 as a
      // hollow halo ring around the sprite. That ring and all specks are thin and tiny next to
      // the body, so keeping every component above 5% of the largest drops them while preserving
      // sizeable detached parts (the dung ball, a broken-off leg).
      int[] comp = new int[W * H]; // 0 = unvisited, -1 = transparent, >0 = component id
      var sizes = new List<int>(); sizes.Add(0);
      var queue = new Queue<int>();
      int id = 0;
      for (int y = 0; y < H; y++) {
        for (int x = 0; x < W; x++) {
          int o0 = y * W + x;
          if (comp[o0] != 0) continue;
          if (px[y * s + x * 4 + 3] <= 8) { comp[o0] = -1; continue; }
          id++; comp[o0] = id; queue.Enqueue(o0); int n = 1;
          while (queue.Count > 0) {
            int o = queue.Dequeue();
            int cx = o % W, cy = o / W;
            for (int k = 0; k < 4; k++) {
              int nx = cx + DX[k], ny = cy + DY[k];
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              int no = ny * W + nx;
              if (comp[no] != 0) continue;
              if (px[ny * s + nx * 4 + 3] <= 8) { comp[no] = -1; continue; }
              comp[no] = id; n++; queue.Enqueue(no);
            }
          }
          sizes.Add(n);
        }
      }
      int bestSize = 0;
      for (int c = 1; c < sizes.Count; c++) { if (sizes[c] > bestSize) bestSize = sizes[c]; }
      int minKeep = Math.Max(200, bestSize / 20);
      var keep = new bool[sizes.Count];
      int keptParts = 0;
      for (int c = 1; c < sizes.Count; c++) {
        keep[c] = sizes[c] >= minKeep;
        if (keep[c]) keptParts++;
      }
      for (int y = 0; y < H; y++) {
        for (int x = 0; x < W; x++) {
          int o = y * W + x;
          int cid = comp[o];
          if (cid < 1 || !keep[cid]) { px[y * s + x * 4 + 3] = 0; continue; }
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      Marshal.Copy(px, 0, data.Scan0, px.Length);
      bmp.UnlockBits(data);
      if (maxX < 0) throw new Exception("nothing left after keying, check the background: " + srcPath);

      var bounds = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
      var cropped = bmp.Clone(bounds, PixelFormat.Format32bppArgb);

      double fit = Math.Min((double)target / cropped.Width, (double)target / cropped.Height);
      int w = Math.Max(1, (int)Math.Round(cropped.Width * fit));
      int h = Math.Max(1, (int)Math.Round(cropped.Height * fit));

      // Center on a square canvas with symmetric transparent margins (the game draws from the center).
      var outBmp = new Bitmap(target, target, PixelFormat.Format32bppArgb);
      using (var g2 = Graphics.FromImage(outBmp)) {
        g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g2.SmoothingMode = SmoothingMode.HighQuality;
        g2.DrawImage(cropped, (target - w) / 2, (target - h) / 2, w, h);
      }
      cropped.Dispose(); bmp.Dispose();
      outBmp.Save(dstPath, ImageFormat.Png);
      var info = new StringBuilder();
      info.AppendFormat("key=#{0:X2}{1:X2}{2:X2} bbox={3}x{4} fit={5:F2} ink={6}x{7} comps={8} kept={9}/{10}px",
        key.R, key.G, key.B, bounds.Width, bounds.Height, fit, w, h, sizes.Count - 1, keptParts, bestSize);
      return info.ToString();
    }
  }

  public static void Sheet(List<string> files, List<string> labels, List<int> logical, string dst, int cell, int zoom) {
    int cols = 4;
    int rows = (files.Count + cols - 1) / cols;
    var sheet = new Bitmap(cols * cell, rows * (cell + 22), PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(sheet)) {
      g.Clear(Color.FromArgb(0x2a, 0x3a, 0x3a)); // GROUND.base in js/consts.js, so contrast is judged on the real floor
      g.TextRenderingHint = TextRenderingHint.AntiAlias;
      using (var font = new Font("Arial", 11f))
      using (var brush = new SolidBrush(Color.FromArgb(170, 170, 170))) {
        for (int i = 0; i < files.Count; i++) {
          int cx = (i % cols) * cell, cy = (i / cols) * (cell + 22);
          using (var img = new Bitmap(files[i])) {
            // uniform zoom keeps relative sizes honest while staying big enough to judge edges
            int size = logical[i] * 2 * zoom;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.DrawImage(img, cx + (cell - size) / 2, cy + (cell - size) / 2, size, size);
          }
          g.DrawString(labels[i], font, brush, cx + 6, cy + cell + 2);
        }
      }
    }
    sheet.Save(dst, ImageFormat.Png);
    sheet.Dispose();
  }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

# logical sizes come from PLAYER_SPRITE_SIZE and MONSTER_TYPES radii in js/
# The three concept bosses at the bottom (endospore/botulinum/biofilm) have no gameplay yet
# (2026-09-17 concept art), so their logical size is a provisional radius*2 guess;
# sync it once the fight is designed.
$jobs = @(
  @{ prefix = 'player_idle'; logical = 42 },
  @{ prefix = 'companion';   logical = 22 }, # display size = COMPANION_SPRITE_SIZE in js/consts.js (hit radius stays 8)
  @{ prefix = 'mob_basic';   logical = 28 },
  @{ prefix = 'mob_fast';    logical = 20 },
  @{ prefix = 'mob_tank';    logical = 44 },
  @{ prefix = 'mob_ranged';  logical = 26 },
  @{ prefix = 'mob_chest';   logical = 32 },
  @{ prefix = 'boss1';       logical = 68 },
  @{ prefix = 'boss_giantcell';   logical = 76 }, # Haihuo: canvas is 8px larger than the hit box so the pseudopods can reach out
  @{ prefix = 'boss_endospore'; logical = 88 },
  @{ prefix = 'boss_botulinum'; logical = 76 },
  @{ prefix = 'boss_biofilm';   logical = 96 }  # Mowang: real in-game spriteSize; radius 38 plus a 10px slime skirt
)

if (-not (Test-Path $Dst)) { New-Item -ItemType Directory -Path $Dst -Force | Out-Null }
$done = @()

foreach ($j in $jobs) {
  $srcFile = Get-ChildItem -Path (Join-Path $Src ($j.prefix + '_*.png')) -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $srcFile) { Write-Warning "no source for $($j.prefix)"; continue }

  $target = $j.logical * 2   # @2x export
  $outName = $j.prefix + '.png'
  $outPath = Join-Path $Dst $outName
  $info = [SpriteKit]::Process($srcFile.FullName, $outPath, $target)
  Write-Host ("{0,-16} {1,3}px -> {2,4}px  {3}" -f $outName, $j.logical, $target, $info)
  $done += [pscustomobject]@{ file = $outPath; label = ($outName + ' ' + $j.logical + 'px'); logical = $j.logical }
}

if ($Sheet -and $done.Count) {
  $zoom = [Math]::Max(1, $Zoom)
  $cell = ($done | Measure-Object -Property logical -Maximum).Maximum * 2 * $zoom + 40
  [SpriteKit]::Sheet(
    [System.Collections.Generic.List[string]]($done.file),
    [System.Collections.Generic.List[string]]($done.label),
    [System.Collections.Generic.List[int]]($done.logical),
    (Join-Path $Src 'contact_sheet.png'), [int]$cell, $zoom)
  Write-Host "sheet: $Src\contact_sheet.png"
}
