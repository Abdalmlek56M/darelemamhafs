using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Features.CreateStudent;
using Dar.Modules.Secretariat.Features.GetStudent;
using Dar.Modules.Secretariat.Features.ListStudents;
using Dar.Modules.Secretariat.Persistence;

namespace Dar.Modules.Secretariat;

public static class SecretariatModule
{
    public static IServiceCollection AddSecretariatModule(this IServiceCollection services)
    {
        services.AddScoped<IStudentRepository, StudentRepository>();
        services.AddScoped<ListStudentsHandler>();
        services.AddScoped<GetStudentHandler>();
        services.AddScoped<CreateStudentHandler>();
        return services;
    }

    public static IEndpointRouteBuilder MapSecretariatEndpoints(this IEndpointRouteBuilder app)
    {
        var students = app.MapGroup("/api/v1/students").WithTags("secretariat");
        students.MapListStudents();
        students.MapGetStudent();
        students.MapCreateStudent();
        return app;
    }
}
