using System;
using Microsoft.Win32;

namespace OutlookCompanion
{
    internal static class StartupRegistration
    {
        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "NoMistakeOutlookCompanion";

        public static bool IsEnabled()
        {
            using RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
            return key?.GetValue(ValueName) is string value && value.Length > 0;
        }

        public static void SetEnabled(bool enabled, string executablePath)
        {
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKeyPath, true);
            if (enabled)
            {
                string command = "\"" + executablePath + "\" --tray";
                key.SetValue(ValueName, command, RegistryValueKind.String);
            }
            else
            {
                key.DeleteValue(ValueName, false);
            }
        }
    }
}
