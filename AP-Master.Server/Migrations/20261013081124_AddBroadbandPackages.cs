using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AP_Master.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddBroadbandPackages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BroadbandPackages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    DownloadMbps = table.Column<int>(type: "INTEGER", nullable: false),
                    UploadMbps = table.Column<int>(type: "INTEGER", nullable: false),
                    MonthlyPrice = table.Column<decimal>(type: "TEXT", precision: 8, scale: 2, nullable: false),
                    ContractMonths = table.Column<int>(type: "INTEGER", nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    IsAvailable = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BroadbandPackages", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BroadbandPackages_Name",
                table: "BroadbandPackages",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BroadbandPackages");
        }
    }
}
