# Demande à Windows lui-même s'il connaît Orbe comme application inscrite
# (interface IApplicationAssociationRegistration, celle des « programmes par
# défaut »). À lancer après l'inscription. Indicatif : cette interface date de
# Vista et Windows 10/11 n'y répond plus toujours ; un nom inconnu sert de témoin.
$code = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("4e530b0a-e611-4c77-a3ac-9031d022281b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IApplicationAssociationRegistration {
  [PreserveSig] int QueryCurrentDefault([MarshalAs(UnmanagedType.LPWStr)] string query, int type, int level, [MarshalAs(UnmanagedType.LPWStr)] out string association);
  [PreserveSig] int QueryAppIsDefault([MarshalAs(UnmanagedType.LPWStr)] string query, int type, int level, [MarshalAs(UnmanagedType.LPWStr)] string app, [MarshalAs(UnmanagedType.Bool)] out bool isDefault);
  [PreserveSig] int QueryAppIsDefaultAll(int level, [MarshalAs(UnmanagedType.LPWStr)] string app, [MarshalAs(UnmanagedType.Bool)] out bool isDefault);
}

public static class OrbeAssoc {
  public static string Ask(string app) {
    var reg = (IApplicationAssociationRegistration)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("591209c7-767b-42b2-9fba-44ee4615f2c7")));
    bool all; bool http; string current;
    int a = reg.QueryAppIsDefaultAll(1, app, out all);
    int b = reg.QueryAppIsDefault("http", 1, 1, app, out http);
    int c = reg.QueryCurrentDefault("http", 1, 1, out current);
    return String.Format("{0}|{1}|{2}|{3}|{4}|{5}", a, all, b, http, c, current);
  }
}
'@
Add-Type -TypeDefinition $code
$orbe = [OrbeAssoc]::Ask('Orbe').Split('|')
$none = [OrbeAssoc]::Ask('OrbeInexistant').Split('|')
$hex = { param($n) '0x{0:X8}' -f [int]$n }
Write-Host "Orbe            : QueryAppIsDefaultAll -> $(& $hex $orbe[0]) (par défaut : $($orbe[1])) ; QueryAppIsDefault(http) -> $(& $hex $orbe[2]) (par défaut : $($orbe[3]))"
Write-Host "Nom inconnu     : QueryAppIsDefaultAll -> $(& $hex $none[0]) ; QueryAppIsDefault(http) -> $(& $hex $none[2])"
Write-Host "Navigateur actuel pour http : $($orbe[5]) ($(& $hex $orbe[4]))"
$known = ([int]$orbe[0] -eq 0 -and [int]$none[0] -ne 0) -or ([int]$orbe[2] -eq 0 -and [int]$none[2] -ne 0)
if ($known) { Write-Host 'Windows reconnaît Orbe comme application inscrite (et pas le nom inconnu).' }
else { Write-Host 'Pas de réponse probante : Windows ne distingue pas Orbe d''un nom inconnu par cette interface.'; exit 1 }
