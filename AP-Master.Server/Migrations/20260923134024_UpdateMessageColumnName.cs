using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AP_Master.Server.Migrations
{
    /// <inheritdoc />
    public partial class UpdateMessageColumnName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Timestamp",
                table: "Messages",
                newName: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CreatedAt",
                table: "Messages",
                newName: "Timestamp");
        }
    }
}
