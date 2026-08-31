// NoMistake Phase 4B - COM 공용 유틸리티(Outlook RCW 추적/해제, 안전 접근자, ROT attach).
//
// COM 접근: dynamic late-binding(ProgID 활성화) - interop 어셈블리/COMReference가 필요 없다.
//   - 현재 빌드 환경: Windows 내장 csc.exe(.NET Framework 4.x) - build.ps1 사용
//   - .NET SDK 설치 후: dotnet build(OutlookCompanion.csproj)로 동일 소스 빌드 가능
//   - 실행 중 Outlook attach는 Marshal.GetActiveObject 대신 ole32 P/Invoke를 직접 사용한다.
//     (.NET Framework의 Marshal.GetActiveObject는 .NET(5+)에 없어 csproj(net8.0) 빌드를 깨뜨리기 때문.
//      ole32.dll!GetActiveObject + CLSIDFromProgID는 두 런타임 모두 동일하게 동작한다.)
//
// [안전] 읽기 전용(항목 생성/수정/삭제 없음). 이 프로그램이 Outlook을 시작한 경우에만 Quit()한다.
// [수명] Phase 4B 정책: 매 poll cycle마다 짧게 attach -> read -> 전량 release (장기 session 유지 안 함).
//        사유: (1) 사용자의 Outlook 재시작/종료 시 stale RCW 방지, (2) cycle 단위 COM leak 검증 용이,
//              (3) attach 오버헤드는 ms 단위로 polling 비용에 비해 무시 가능.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace OutlookCompanion
{
    internal static class ComHost
    {
        // ===== Outlook enum 상수 =====
        public const int OlAppointmentItem = 26;      // OlItemType.olAppointmentItem (Item.Class)
        public const int OlDefaultItemAppointment = 1; // OlItemType.olAppointmentItem (Folder.DefaultItemType)
        public const int OlDefaultFolderCalendar = 9;  // OlDefaultFolders.olFolderCalendar
        public const int OlModuleCalendar = 1;         // OlNavigationModuleType.olModuleCalendar

        // COM RCW 추적: 얻은 참조를 cycle 종료 시 명시 해제한다(Outlook.exe/COM 참조 잔존 방지).
        private static readonly List<object> ComRefs = new List<object>();

        public static T Track<T>(T obj) where T : class
        {
            if (obj != null && Marshal.IsComObject(obj)) ComRefs.Add(obj);
            return obj;
        }

        // 역순 FinalReleaseComObject + GC 2회. 해제한 RCW 수를 반환한다.
        public static int ReleaseAllCom()
        {
            int released = 0;
            for (int i = ComRefs.Count - 1; i >= 0; i--)
            {
                try
                {
                    if (Marshal.IsComObject(ComRefs[i]))
                    {
                        Marshal.FinalReleaseComObject(ComRefs[i]);
                        released++;
                    }
                }
                catch { /* 개별 해제 실패는 프로세스 종료 시 정리됨 */ }
            }
            ComRefs.Clear();
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            return released;
        }

        // COM 속성 값을 안전하게 문자열로.
        public static string S(object v)
        {
            if (v == null) return "";
            string s = v.ToString();
            return s ?? "";
        }

        public static string RecStateName(int state)
        {
            if (state == 0) return "olApptNotRecurring";
            if (state == 1) return "olApptMaster";
            if (state == 2) return "olApptOccurrence"; // MERI 실측(2026-08-31): 확장 열거 시 occurrence가 2로 관측됨
            if (state == 3) return "olApptException";  // 개인 캘린더 실측(2026-08-31): 시간 변경된 occurrence는 3(olApptException). 4A 코드의 4는 오류였음.
            return "Unknown(" + state + ")";
        }

        // ===== ROT(Running Object Table) attach =====
        // 실행 중인 Outlook.Application에 연결한다. 없으면 COMException이 발생한다.
        // (Marshal.GetActiveObject("Outlook.Application")와 동일 동작, 런타임 독립 구현)
        // 주의: GetActiveObject는 oleaut32.dll에 있다(ole32 아님).
        [DllImport("oleaut32.dll", PreserveSig = false)]
        private static extern void GetActiveObject(ref Guid rclsid, IntPtr reserved, [MarshalAs(UnmanagedType.IUnknown)] out object ppunk);

        [DllImport("ole32.dll", PreserveSig = false)]
        private static extern void CLSIDFromProgID([MarshalAs(UnmanagedType.LPWStr)] string progId, out Guid pclsid);

        public static object AttachRunningOutlook()
        {
            Guid clsid;
            CLSIDFromProgID("Outlook.Application", out clsid);
            object app;
            GetActiveObject(ref clsid, IntPtr.Zero, out app);
            return app; // RCW. Track()은 호출자가 수행한다.
        }

        // OUTLOOK.EXE 프로세스 존재 여부(프로그램이 임의로 Outlook을 시작하지 않는 정책용).
        public static bool IsOutlookProcessRunning()
        {
            return System.Diagnostics.Process.GetProcessesByName("OUTLOOK").Length > 0;
        }
    }
}