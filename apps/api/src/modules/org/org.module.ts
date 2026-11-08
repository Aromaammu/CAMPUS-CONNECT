import { Module } from '@nestjs/common';
import { BranchesController, HolidaysController } from './branches.controller';
import { OrgController } from './org.controller';
import { EmployeesController } from '../people/employees.controller';
import { StudentsController } from '../people/students.controller';
import { PeopleService } from '../people/people.service';

@Module({
  controllers: [BranchesController, HolidaysController, OrgController, EmployeesController, StudentsController],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class OrgModule {}
