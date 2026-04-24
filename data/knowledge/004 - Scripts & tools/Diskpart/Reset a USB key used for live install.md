```bash
diskpart
list disk # Search for the usb key by using it's size
select disk X # replace X by the disk you want to clean
clean
create partition primary
select partition 1
format fs=ntfs quick # Change 'ntfs' by 'fat32' if needed
assign # assign a letter to the drive
exit
```