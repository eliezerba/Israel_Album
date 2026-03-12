$outDir = "c:\Users\user\Ilanot Project Dropbox\Eliezer Baumgarten\אקדמיה\digital humanities\פלטפורמות הצגה\Israel_Album"
$BASE = "http://localhost:8000"

# Albums already downloaded (by id)
$existing = @("AL046","AL048","AL051","AL061")

# Get full album list
$allAlbums = (Invoke-WebRequest -Uri "$BASE/api/albums" -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty albums
$toDownload = $allAlbums | Where-Object { $_.id -notin $existing }

Write-Host "Albums to download: $($toDownload.Count)"

foreach ($al in $toDownload) {
    $id = $al.id
    Write-Host "Downloading $id : $($al.title_en)..." -NoNewline

    # Get full album metadata
    $meta = (Invoke-WebRequest -Uri "$BASE/api/albums/$id" -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty album

    # Fetch all images with pagination (max 200 per page)
    $allImages = [System.Collections.Generic.List[object]]::new()
    $page = 1
    do {
        $resp = (Invoke-WebRequest -Uri "$BASE/api/albums/$id/images?page=$page&page_size=200" -UseBasicParsing).Content | ConvertFrom-Json
        $batch = $resp.images
        foreach ($img in $batch) { $allImages.Add($img) }
        $page++
    } while ($batch -and $batch.Count -eq 200)

    # Map images to expected format
    $imgNum = 0
    $mapped = $allImages | ForEach-Object {
        $imgNum++
        [PSCustomObject]@{
            image_id        = $_.id
            image_num       = $imgNum
            album_id        = $id
            album_title     = if ($meta.title_en) { $meta.title_en } else { $meta.title_he }
            uri             = $_.uri
            width           = $_.width
            height          = $_.height
            caption         = $_.caption
            short_caption   = $_.short_caption
            ocr_text        = $_.ocr_text
            ocr_translation = $_.ocr_translation
        }
    }

    # Build output object
    $out = [PSCustomObject]@{
        album = [PSCustomObject]@{
            id        = $meta.id
            title_en  = $meta.title_en
            title_he  = $meta.title_he
            author    = $meta.author
            publisher = $meta.publisher
            year      = $meta.year
        }
        export_date  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        total_images = $allImages.Count
        images       = @($mapped)
    }

    # Sanitize filename
    $title = if ($meta.title_en) { $meta.title_en } else { $meta.title_he }
    $safeName = $title -replace '[\\/:*?"<>|]', '_'
    $outPath = Join-Path $outDir "album_$safeName.json"

    $out | ConvertTo-Json -Depth 5 | Set-Content -Path $outPath -Encoding UTF8
    Write-Host " OK ($($allImages.Count) images) -> album_$safeName.json"
}

Write-Host ""
Write-Host "Done. Files in folder:"
Get-ChildItem $outDir -Filter "album_*.json" | Sort-Object Name | Select-Object Name, @{N='KB';E={[math]::Round($_.Length/1KB,0)}}
