using System;
using System.IO;
using System.Text;

namespace OutlookCompanion
{
    internal enum SyncGroup
    {
        EvenHours = 0,
        OddHours = 1
    }

    /// <summary>
    /// Multiple PC Companions share one Firestore dataset but avoid doing the same scan at the same time.
    /// Each PC runs every two hours during active hours. Group A uses even hours and Group B uses odd hours,
    /// so when at least one PC from each group is online the shared backend is refreshed about once per hour.
    /// </summary>
    internal static class SyncSchedule
    {
        public const string GroupFileName = "companion-sync-group.txt";

        public static string GroupPath => Path.Combine(SnapshotStore.AppDataDir, GroupFileName);

        public static DateTime NextSlot(DateTime localNow, SyncGroup group)
        {
            DateTime candidate = localNow;
            if (!ActiveHours.IsAutomaticSyncAllowed(candidate))
            {
                candidate = candidate.Date.AddHours(ActiveHours.StartHour);
            }

            // Only exact top-of-hour slots count. If a slot has already started, move to the next eligible hour.
            DateTime top = new DateTime(candidate.Year, candidate.Month, candidate.Day, candidate.Hour, 0, 0, candidate.Kind);
            if (candidate > top) top = top.AddHours(1);

            int parity = group == SyncGroup.EvenHours ? 0 : 1;
            if ((top.Hour & 1) != parity) top = top.AddHours(1);

            // Crossing midnight enters quiet hours; resume at the first slot for this group after 08:00.
            if (!ActiveHours.IsAutomaticSyncAllowed(top))
            {
                DateTime morning = top.Date.AddHours(ActiveHours.StartHour);
                if ((morning.Hour & 1) != parity) morning = morning.AddHours(1);
                top = morning;
            }

            return top;
        }

        public static SyncGroup LoadGroup()
        {
            try
            {
                if (!File.Exists(GroupPath)) return SyncGroup.EvenHours;
                string value = File.ReadAllText(GroupPath, Encoding.UTF8).Trim();
                if (string.Equals(value, "B", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(value, "odd", StringComparison.OrdinalIgnoreCase) || value == "1")
                    return SyncGroup.OddHours;
            }
            catch { }
            return SyncGroup.EvenHours;
        }

        public static void SaveGroup(SyncGroup group)
        {
            try
            {
                Directory.CreateDirectory(SnapshotStore.AppDataDir);
                File.WriteAllText(GroupPath, group == SyncGroup.EvenHours ? "A" : "B", Encoding.UTF8);
            }
            catch { }
        }

        public static string Label(SyncGroup group) =>
            group == SyncGroup.EvenHours ? "A · 짝수시" : "B · 홀수시";
    }
}
