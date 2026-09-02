using System;

namespace OutlookCompanion
{
    internal static class ActiveHours
    {
        public const int StartHour = 8;
        public const int EndHourExclusive = 24;

        public static bool IsAutomaticSyncAllowed(DateTime localNow)
        {
            return localNow.Hour >= StartHour;
        }

        public static DateTime NextAllowedTime(DateTime localNow)
        {
            if (IsAutomaticSyncAllowed(localNow)) return localNow;
            return localNow.Date.AddHours(StartHour);
        }

        public static DateTime NormalizeNextAutomatic(DateTime candidate)
        {
            if (IsAutomaticSyncAllowed(candidate)) return candidate;
            return candidate.Date.AddHours(StartHour);
        }
    }
}
