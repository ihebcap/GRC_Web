using System.Data;

namespace GRC.Application.Interfaces
{
    public interface IDbConnectionFactory
    {
        IDbConnection CreateConnection();
        string GetConnectionString();
    }
}
