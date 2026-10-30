// Controlled copy of packages/shared/src/private-filesystem-permissions.ts; standalone plugin has no shared runtime dependency.
import { execFileSync } from "node:child_process";
import path from "node:path";

// Windows mode bits do not describe NTFS access. Read the actual DACL instead;
// never modify an existing ACL, use localized account names, or trust PATH.
// Use built-in .NET ACL APIs; do not load modules from inherited PSModulePath.
const privateAclValidation = `
function Assert-PrivateAcl([string]$target) {
  $attributes = [IO.File]::GetAttributes($target)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  $isDirectory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
  $acl = if ($isDirectory) { [IO.Directory]::GetAccessControl($target) } else { [IO.File]::GetAccessControl($target) }
  $sidType = [Security.Principal.SecurityIdentifier]
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($acl.GetOwner($sidType).Value -ne $user) { throw 'different owner' }
  $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $raw.DiscretionaryAcl) { throw 'null DACL' }
  $ownerAllowed = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, $sidType)) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
    $sid = $rule.IdentityReference.Value
    $inheritOnly = ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0
    if ($sid -eq $user -and !$inheritOnly) { $ownerAllowed = $true }
    # SYSTEM and Administrators are OS privileged principals, analogous to
    # root on POSIX. CREATOR OWNER is safe only as an inheritance placeholder.
    if ($sid -notin @($user, 'S-1-5-18', 'S-1-5-32-544') -and !($sid -eq 'S-1-3-0' -and $inheritOnly)) { throw 'broader access' }
  }
  if (!$ownerAllowed) { throw 'no owner access' }
}
`;

const aclProbe = `
$ErrorActionPreference = 'Stop'
${privateAclValidation}
try {
  Assert-PrivateAcl $env:PAPERCLIP_PRIVATE_ACL_TARGET
  [Console]::Out.Write('private')
} catch { [Console]::Out.Write('unverified') }
`;

const aclPairProbe = `
$ErrorActionPreference = 'Stop'
${privateAclValidation}
try {
  Assert-PrivateAcl $env:PAPERCLIP_PRIVATE_ACL_TARGET
  Assert-PrivateAcl $env:PAPERCLIP_PRIVATE_ACL_SECOND_TARGET
  [Console]::Out.Write('private')
} catch { [Console]::Out.Write('unverified') }
`;

const privateAcl = `
$ErrorActionPreference = 'Stop'
try {
  $target = $env:PAPERCLIP_PRIVATE_ACL_TARGET
  $attributes = [IO.File]::GetAttributes($target)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  $isDirectory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
  $acl = if ($isDirectory) { [IO.Directory]::GetAccessControl($target) } else { [IO.File]::GetAccessControl($target) }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'different owner' }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $inherit = if ($isDirectory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  if ($isDirectory) { [IO.Directory]::SetAccessControl($target, $acl) } else { [IO.File]::SetAccessControl($target, $acl) }
  [Console]::Out.Write('protected')
} catch { [Console]::Out.Write('unverified') }
`;

function runAclCommand(script: string, file: string, secondFile = ""): string {
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, PAPERCLIP_PRIVATE_ACL_TARGET: file, PAPERCLIP_PRIVATE_ACL_SECOND_TARGET: secondFile },
    encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 4096,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Call only after exclusive creation, while the new path contains no secrets.
 * Existing files/directories are validated, never silently re-permissioned.
 */
export function protectNewPrivatePath(file: string): void {
  if (process.platform !== "win32") return;
  let protectedPath = false;
  try { protectedPath = path.isAbsolute(file) && runAclCommand(privateAcl, file) === "protected" && hasPrivatePermissions(file, 0); }
  catch { /* Report only a bounded error, never PowerShell output or paths. */ }
  if (!protectedPath) throw new Error("Could not establish a private Windows ACL before writing credentials.");
}

/** Fail closed when ACL inspection is unavailable or wider than owner/OS admin.
 * A denied broad allow is still rejected: this conservative check does not try
 * to emulate Windows effective-access/group evaluation. No credential is read.
 */
export function hasPrivatePermissions(file: string, mode: number): boolean {
  if (process.platform !== "win32") return (mode & 0o077) === 0;
  if (!path.isAbsolute(file)) return false;
  try {
    return runAclCommand(aclProbe, file) === "private";
  } catch { return false; }
}

/** Validate both paths afresh, in order, using one bounded Windows process.
 * All caller paths travel as environment data; an unsafe first path prevents
 * inspection of the second. This does not cache permissions or repair ACLs.
 */
export function hasPrivatePermissionPair(first: string, firstMode: number, second: string, secondMode: number): boolean {
  if (process.platform !== "win32") return (firstMode & 0o077) === 0 && (secondMode & 0o077) === 0;
  if (!path.isAbsolute(first) || !path.isAbsolute(second)) return false;
  try { return runAclCommand(aclPairProbe, first, second) === "private"; }
  catch { return false; }
}
