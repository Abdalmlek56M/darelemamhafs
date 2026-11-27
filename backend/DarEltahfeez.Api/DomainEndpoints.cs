using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private const string StudentSelectColumns = """
        s.id, s.student_code, s.full_name, s.age_years, s.phone, s.guardian_name, s.guardian_phone,
               s.joined_on, s.status, s.notes, s.created_at, s.updated_at,
               COALESCE((SELECT string_agg(c.name, '، ' ORDER BY c.name)
                         FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id
                         WHERE ce.student_id=s.id AND ce.status='active' AND ce.is_trashed=FALSE AND c.is_active=TRUE AND c.is_trashed=FALSE), ''),
               COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce
                         JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
                         WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL), 0),
               COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                         JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                         WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0),
               CASE
                 WHEN NOT EXISTS (SELECT 1 FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                                  WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date) THEN 'not-set'
                 WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                                WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0)
                    >= COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                                 WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) THEN 'paid'
                 WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                                WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) > 0 THEN 'partial'
                 ELSE 'unpaid'
               END AS current_month_payment_status
        """;

    private const string StudentProjection = "SELECT " + StudentSelectColumns + "\nFROM students s";

    public static void Map(WebApplication app)
    {
        MapStudents(app);
        MapTeachers(app);
        MapCircles(app);
        MapEnrollments(app);
        MapScheduleAndAttendance(app);
        MapCollections(app);
        MapReceipts(app);
        MapAdvertisingExpenses(app);
        MapOperatingExpenses(app);
        MapReports(app);
        MapSummaries(app);
    MapProfitSummary(app);
    }














}

public sealed record StudentWriteRequest(string? StudentCode,string FullName,int? AgeYears,string? Phone,string? GuardianName,string? GuardianPhone,DateOnly JoinedOn,string Status,string? Notes);
public sealed record StudentStatusRequest(string Status, DateOnly? EffectiveOn = null);
public sealed record StudentResponse(Guid Id,string StudentCode,string FullName,int? AgeYears,string? Phone,string? GuardianName,string? GuardianPhone,DateOnly JoinedOn,string Status,string? Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,string CircleNames,decimal? CurrentMonthDue,decimal? CurrentMonthPaid,string? CurrentMonthPaymentStatus);
public sealed record StudentNoteRequest(string NoteText);
public sealed record StudentNoteResponse(Guid Id,string NoteText,DateTimeOffset CreatedAt,string CreatedBy);
public sealed record TeacherWriteRequest(string? TeacherCode,string FullName,string? Phone,decimal? HourlyRate,string Status,string? Notes);
public sealed record TeacherResponse(Guid Id,string TeacherCode,string FullName,string? Phone,decimal? HourlyRate,string Status,string? Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,string CircleNames,long CircleCount);
public sealed record CircleWriteRequest(string? CircleCode,string Name,Guid? TeacherId,decimal? MonthlyFee,string? ScheduleText,bool IsActive,DateOnly StartsOn);
public sealed record CircleResponse(Guid Id,string CircleCode,string Name,Guid? TeacherId,string TeacherName,decimal? MonthlyFee,string? ScheduleText,bool IsActive,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,long ActiveStudentCount,DateOnly StartsOn);
public sealed record EnrollmentWriteRequest(Guid StudentId,Guid CircleId,DateOnly StartsOn,decimal? AgreedMonthlyFee,bool AllowClosedCircle = false);
public sealed record EnrollmentEndRequest(DateOnly? EndsOn);
public sealed record EnrollmentStatusChangeRequest(DateOnly? EffectiveOn, string? Reason);
public sealed record ScheduleSlotWriteRequest(Guid CircleId,int DayOfWeek,string StartsAt,int DurationMinutes);
public sealed record ScheduleSlotDraft(int DayOfWeek,string StartsAt,int DurationMinutes);
public sealed record CircleWithScheduleRequest(string? CircleCode,string Name,Guid? TeacherId,decimal? MonthlyFee,string? ScheduleText,bool IsActive,DateOnly StartsOn,IReadOnlyList<ScheduleSlotDraft>? Slots);
public sealed record ScheduleSlotUpdateRequest(int DayOfWeek,string StartsAt,int DurationMinutes,bool? IsActive=null);
public sealed record TeacherAttendanceMarkRequest(Guid ScheduleSlotId,DateOnly SessionDate,string Status,string? Note,Guid? TeacherId = null);
public sealed record TeacherAttendanceDurationRequest(int DurationMinutes);
public sealed record StudentAttendanceMarkRequest(Guid ScheduleSlotId,Guid EnrollmentId,DateOnly SessionDate,string Status,string? Note,bool AllowHistoricalEntry = false);
public sealed record AdvertisingExpenseWriteRequest(Guid CircleId,string? Platform,DateOnly StartDate,int DaysCount,decimal DailyCost,string? Note);
public sealed record OperatingExpenseWriteRequest(DateOnly ExpenseDate,string Category,string Description,decimal Amount,Guid? CircleId,string? Note);
public sealed record ChargeWriteRequest(Guid EnrollmentId,string BillingMonth,decimal AmountDue,string? Note);
public sealed record ChargeUpdateRequest(decimal AmountDue,string? Note);
public sealed record PaymentWriteRequest(Guid MonthlyChargeId,decimal Amount,DateTimeOffset? PaidAt,string? Method,string? Reference,string? Note);
public sealed record CollectionReportCreateRequest(string BillingMonth,string? Title);
public sealed record CollectionRow(Guid EnrollmentId,Guid? ChargeId,Guid StudentId,string StudentCode,string StudentName,Guid CircleId,string CircleName,string TeacherName,decimal AgreedMonthlyFee,decimal AmountDue,decimal PaidAmount,string? Note,string PaymentStatus,DateOnly BillingMonth,DateOnly EnrollmentStartsOn,DateOnly? EnrollmentEndsOn,DateOnly CircleStartsOn)
{
    public decimal Balance=>MoneyRules.NonNegativeBalance(AmountDue,PaidAmount);
}
public sealed record PaymentHistory(Guid Id,decimal Amount,DateTimeOffset PaidAt,string? Method,string? Reference,string? Note,bool HasReceipt,DateTimeOffset? VoidedAt=null,string? VoidReason=null,string? VoidBlockedReason=null);
public sealed class ChargeHistoryBuilder(Guid id,DateOnly billingMonth,decimal amountDue,string? note,string circleName,DateTimeOffset? voidedAt=null,string? voidReason=null)
{
    public Guid Id {get;}=id; public DateOnly BillingMonth {get;}=billingMonth; public decimal AmountDue {get;}=amountDue; public string? Note {get;}=note; public string CircleName {get;}=circleName;
    public DateTimeOffset? VoidedAt {get;}=voidedAt; public string? VoidReason {get;}=voidReason;
    public List<PaymentHistory> Payments {get;}=[];
    public decimal PaidAmount=>Payments.Where(p=>p.VoidedAt is null).Sum(p=>p.Amount);
    public object ToResponse()=>new{id=Id,billingMonth=BillingMonth,amountDue=AmountDue,paidAmount=PaidAmount,balance=MoneyRules.NonNegativeBalance(AmountDue,PaidAmount),note=Note,circleName=CircleName,voidedAt=VoidedAt,voidReason=VoidReason,payments=Payments};
}
public sealed record VoidRequest(string? Reason,string? Note=null);