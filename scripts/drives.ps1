Get-PSDrive -PSProvider FileSystem | ForEach-Object { Write-Output ($_.Name + " " + $_.Root) }
