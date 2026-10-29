import { execFileSync } from "node:child_process";
import path from "node:path";

/** Test-only: a marked temporary root must own the ACL target. No real keys. */
export function setFixtureAcl(root: string, file: string, broad: boolean) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error("ACL fixture target must be a descendant");
  const command = `
$ErrorActionPreference='Stop'
$target=$env:PAPERCLIP_FIXTURE_ACL_TARGET
$attributes=[IO.File]::GetAttributes($target)
if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refuse reparse fixture' }
$isDirectory=($attributes -band [IO.FileAttributes]::Directory) -ne 0
$acl=if($isDirectory){[IO.Directory]::GetAccessControl($target)}else{[IO.File]::GetAccessControl($target)}
$acl.SetAccessRuleProtection($true,$false)
foreach($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($user)
$inherit=if($isDirectory){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
if($env:PAPERCLIP_FIXTURE_ACL_BROAD -eq 'true') {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::ReadAndExecute,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
}
if($isDirectory){[IO.Directory]::SetAccessControl($target,$acl)}else{[IO.File]::SetAccessControl($target,$acl)}
`;
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
      env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file, PAPERCLIP_FIXTURE_ACL_BROAD: String(broad) },
      windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
    });
}
