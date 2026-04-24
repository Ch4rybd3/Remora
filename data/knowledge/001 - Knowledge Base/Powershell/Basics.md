# Basic commands
```PowerShell
Get-Command -Verb Get
Get-Command -Noun Process # Most used since its the core of the command
Get-Process # List all the process
Get-Help # Equivalent of the "man" command on linux
Start-Transcript # Start the logging session
Stop-Transcript # Stop the logging session
```
# Basic tips
```PowerShell
Get-Process | Select-Object Name, Id, CPU # Select the object that we want in the result
Get-Process | Measure-Object # Equivalent to "count"
Get-Process | Where-Object {$_.ProcessName -eq "firefox"} | Measure-Object # Count the number of firefox processes running
```

# Object related
```PowerShell
Select-Object -First 10
Measure-Object
Where-Object
Group-Object
Sort-Object -Descending
```

# Exporting results
```PowerShell
Export-Csv -Path C:\Temp\process.csv
ConvertTo-Json
```